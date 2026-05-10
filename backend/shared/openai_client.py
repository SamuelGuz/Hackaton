"""OpenAI client wrapper. Lazy singleton + helpers."""

from __future__ import annotations

import logging
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

logger = logging.getLogger(__name__)

MODEL_REASONING = "gpt-4o"
MODEL_FAST = "gpt-4o-mini"

_client: OpenAI | None = None


def get_client() -> OpenAI:
    """Return a process-wide singleton OpenAI client."""
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Missing OPENAI_API_KEY environment variable. "
                "Set it in .env or the environment before calling get_client()."
            )
        _client = OpenAI(api_key=api_key)
    return _client


def complete_with_tools(
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    max_tokens: int = 4096,
    temperature: float = 0.3,
    model: str = MODEL_REASONING,
) -> Any:
    """Call chat.completions.create with tools and return the raw response.

    `messages` should NOT include the system message — it is prepended here.
    Caller inspects `response.choices[0].message`, `finish_reason`, and
    `message.tool_calls`.
    """
    client = get_client()
    full_messages = [{"role": "system", "content": system}] + messages
    return client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        tools=tools,
        tool_choice="auto",
        messages=full_messages,
    )


def complete_simple(
    system: str,
    user: str,
    max_tokens: int = 1024,
    temperature: float = 0.2,
    model: str = MODEL_FAST,
) -> str:
    """Single-shot completion. Returns the assistant message content."""
    client = get_client()
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return response.choices[0].message.content or ""
