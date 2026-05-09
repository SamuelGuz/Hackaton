"""Anthropic Claude client wrapper with retries and optional JSON extraction."""

from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, TypeVar

from anthropic import Anthropic
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential

load_dotenv()

T = TypeVar("T")

DEFAULT_HAIKU = "claude-3-5-haiku-20241022"
DEFAULT_SONNET = "claude-3-5-sonnet-20241022"

def haiku_model() -> str:
    return os.environ.get("CLAUDE_HAIKU_MODEL", DEFAULT_HAIKU).strip() or DEFAULT_HAIKU


def sonnet_model() -> str:
    return os.environ.get("CLAUDE_SONNET_MODEL", DEFAULT_SONNET).strip() or DEFAULT_SONNET


def _extract_json_array_or_object(text: str) -> Any:
    """Parse first JSON object or array from model output."""
    text = text.strip()
    # Strip markdown fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try to find JSON array
    for opener, closer in (("[", "]"), ("{", "}")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Could not parse JSON from model output: {text[:500]}...")


class ClaudeClient:
    def __init__(self, api_key: str | None = None) -> None:
        key = (api_key or os.environ.get("ANTHROPIC_API_KEY", "")).strip()
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set.")
        self._client = Anthropic(api_key=key)

    @retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=2, max=60))
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
        """Run complete() for each item with a thread pool (bounded concurrency)."""
        results: list[Any | str | None] = [None] * len(items)

        def _one(idx: int, item: T) -> tuple[int, Any | str]:
            p = prompt_fn(item)
            if as_json:
                return idx, self.complete_json(p, model=model)
            return idx, self.complete(p, model=model)

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {ex.submit(_one, i, items[i]): i for i in range(len(items))}
            for fut in as_completed(futs):
                idx, out = fut.result()
                results[idx] = out
        return results  # type: ignore[return-value]


def get_claude_client() -> ClaudeClient:
    return ClaudeClient()
