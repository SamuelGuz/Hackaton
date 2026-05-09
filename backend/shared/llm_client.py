"""Unified LLM client: Anthropic or OpenAI, selected via LLM_PROVIDER in .env."""

from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Protocol, TypeVar

from dotenv import load_dotenv
from tenacity import RetryCallState, retry, stop_after_attempt, wait_exponential

load_dotenv()

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_HAIKU = "claude-3-5-haiku-20241022"
DEFAULT_SONNET = "claude-3-5-sonnet-20241022"
DEFAULT_OPENAI_FAST = "gpt-4o-mini"
DEFAULT_OPENAI_QUALITY = "gpt-4o"


def llm_provider() -> str:
    return (os.environ.get("LLM_PROVIDER", "anthropic") or "anthropic").strip().lower()


def haiku_model() -> str:
    """Fast / cheap tier (tickets, conversations, NPS batch)."""
    if llm_provider() == "openai":
        return (os.environ.get("OPENAI_FAST_MODEL", DEFAULT_OPENAI_FAST) or DEFAULT_OPENAI_FAST).strip()
    return (os.environ.get("CLAUDE_HAIKU_MODEL", DEFAULT_HAIKU) or DEFAULT_HAIKU).strip()


def sonnet_model() -> str:
    """Higher-quality tier (historical deals batch)."""
    if llm_provider() == "openai":
        return (os.environ.get("OPENAI_QUALITY_MODEL", DEFAULT_OPENAI_QUALITY) or DEFAULT_OPENAI_QUALITY).strip()
    return (os.environ.get("CLAUDE_SONNET_MODEL", DEFAULT_SONNET) or DEFAULT_SONNET).strip()


def _extract_json_array_or_object(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("[", "]"), ("{", "}")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Could not parse JSON from model output: {text[:500]}...")


def _log_retry(retry_state: RetryCallState) -> None:
    if retry_state.outcome is None or not retry_state.outcome.failed:
        return
    exc = retry_state.outcome.exception()
    logger.warning(
        "LLM request failed; retrying (attempt %s): %s: %s",
        retry_state.attempt_number,
        type(exc).__name__,
        exc,
        exc_info=exc is not None,
    )


class LLMClient(Protocol):
    def complete(
        self,
        prompt: str,
        *,
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        expect_json: bool = False,
    ) -> str: ...

    def complete_json(self, prompt: str, **kwargs: Any) -> Any: ...

    def batch_complete(
        self,
        items: list[T],
        prompt_fn: Callable[[T], str],
        *,
        model: str | None = None,
        max_workers: int = 5,
        as_json: bool = False,
    ) -> list[Any | str]: ...


class AnthropicLLM:
    def __init__(self, api_key: str | None = None) -> None:
        from anthropic import Anthropic

        key = (api_key or os.environ.get("ANTHROPIC_API_KEY", "")).strip()
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set (LLM_PROVIDER=anthropic).")
        self._client = Anthropic(api_key=key)

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=60),
        before_sleep=_log_retry,
        reraise=True,
    )
    def complete(
        self,
        prompt: str,
        *,
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        expect_json: bool = False,
    ) -> str:
        model = model or DEFAULT_HAIKU
        msg = self._client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )
        text = ""
        for block in msg.content:
            if hasattr(block, "text"):
                text += block.text
        text = text.strip()
        if expect_json:
            _extract_json_array_or_object(text)
        return text

    def complete_json(self, prompt: str, **kwargs: Any) -> Any:
        raw = self.complete(prompt, expect_json=False, **kwargs)
        return _extract_json_array_or_object(raw)

    def batch_complete(
        self,
        items: list[T],
        prompt_fn: Callable[[T], str],
        *,
        model: str | None = None,
        max_workers: int = 5,
        as_json: bool = False,
    ) -> list[Any | str]:
        results: list[Any | str | None] = [None] * len(items)

        def _one(idx: int, item: T) -> tuple[int, Any | str]:
            p = prompt_fn(item)
            if as_json:
                return idx, self.complete_json(p, model=model)
            return idx, self.complete(p, model=model)

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {ex.submit(_one, i, items[i]): i for i in range(len(items))}
            for fut in as_completed(futs):
                try:
                    idx, out = fut.result()
                except Exception as e:
                    logger.error("LLM batch_complete worker failed: %s", e, exc_info=True)
                    raise
                results[idx] = out
        return results  # type: ignore[return-value]


class OpenAILLM:
    def __init__(self, api_key: str | None = None) -> None:
        from openai import OpenAI

        key = (api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set (LLM_PROVIDER=openai).")
        self._client = OpenAI(api_key=key)

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=60),
        before_sleep=_log_retry,
        reraise=True,
    )
    def complete(
        self,
        prompt: str,
        *,
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        expect_json: bool = False,
    ) -> str:
        model = model or DEFAULT_OPENAI_FAST
        resp = self._client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )
        choice = resp.choices[0].message
        text = (choice.content or "").strip()
        if expect_json:
            _extract_json_array_or_object(text)
        return text

    def complete_json(self, prompt: str, **kwargs: Any) -> Any:
        raw = self.complete(prompt, expect_json=False, **kwargs)
        return _extract_json_array_or_object(raw)

    def batch_complete(
        self,
        items: list[T],
        prompt_fn: Callable[[T], str],
        *,
        model: str | None = None,
        max_workers: int = 5,
        as_json: bool = False,
    ) -> list[Any | str]:
        results: list[Any | str | None] = [None] * len(items)

        def _one(idx: int, item: T) -> tuple[int, Any | str]:
            p = prompt_fn(item)
            if as_json:
                return idx, self.complete_json(p, model=model)
            return idx, self.complete(p, model=model)

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {ex.submit(_one, i, items[i]): i for i in range(len(items))}
            for fut in as_completed(futs):
                try:
                    idx, out = fut.result()
                except Exception as e:
                    logger.error("LLM batch_complete worker failed: %s", e, exc_info=True)
                    raise
                results[idx] = out
        return results  # type: ignore[return-value]


def get_llm_client() -> AnthropicLLM | OpenAILLM:
    """Instantiate LLM client from LLM_PROVIDER."""
    prov = llm_provider()
    try:
        if prov == "openai":
            return OpenAILLM()
        if prov in ("anthropic", "claude"):
            return AnthropicLLM()
        raise ValueError(f"Unsupported LLM_PROVIDER={prov!r}; use 'anthropic' or 'openai'.")
    except Exception as e:
        logger.error("Failed to initialize LLM client (LLM_PROVIDER=%s): %s", prov, e, exc_info=True)
        raise


def get_claude_client() -> AnthropicLLM | OpenAILLM:
    """Backward-compatible alias for get_llm_client()."""
    return get_llm_client()
