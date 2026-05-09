"""Backward-compatible re-exports. Prefer ``backend.shared.llm_client`` for new code."""

from backend.shared.llm_client import (
    AnthropicLLM,
    LLMClient,
    OpenAILLM,
    get_claude_client,
    get_llm_client,
    haiku_model,
    llm_provider,
    sonnet_model,
)

# Type alias: generators historically typed ``ClaudeClient``.
ClaudeClient = LLMClient

__all__ = [
    "AnthropicLLM",
    "ClaudeClient",
    "LLMClient",
    "OpenAILLM",
    "get_claude_client",
    "get_llm_client",
    "haiku_model",
    "llm_provider",
    "sonnet_model",
]
