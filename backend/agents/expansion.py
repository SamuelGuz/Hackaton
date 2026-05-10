"""Expansion agent — autonomous tool-calling loop that produces an upsell
readiness analysis for a B2B SaaS account and persists it to
``account_health_snapshot``.

Implements the contract defined in CONTRACTS.md sections 2.2 and 2.5.5/2.5.6.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from backend.agents.tools import EXPANSION_TOOLS_SPEC, TOOL_DISPATCH
from backend.shared.openai_client import MODEL_REASONING, get_client
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_VERSION = "expansion-v1.0"
MAX_TURNS = 10
MAX_TOKENS = 4096
TEMPERATURE = 0.3
TIMEOUT_SECONDS = 60

CACHE_TTL_HOURS = 24


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ExpansionError(Exception):
    """Base exception for Expansion agent errors."""


class MaxTurnsExceeded(ExpansionError):
    """Raised when the agent exhausts MAX_TURNS without submitting a final analysis."""


class InvalidOutputError(ExpansionError):
    """Raised when the agent submits a final analysis that fails schema validation."""


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


PlanTier = Literal["starter", "growth", "business", "enterprise"]


class ExpansionOutput(BaseModel):
    expansion_score: int = Field(..., ge=0, le=100)
    ready_to_expand: bool
    recommended_plan: PlanTier
    reasoning: str
    suggested_upsell_message: str


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = """You are the Expansion Agent for Acme SaaS Inc., a B2B SaaS company.

Your job: analyze a single customer account, decide whether they are ready for an upsell, recommend the next plan tier, and draft a short upsell message that the customer success team can send to the champion.

You operate autonomously by calling tools to gather evidence before reaching a conclusion. The tools available let you:
- Pull account fundamentals (industry, size, plan, ARR, contract renewal date, champion).
- Pull usage events (logins, feature use, sessions) over time.
- Pull support tickets with sentiment.
- Pull recent conversations (emails, calls, slack) with sentiment.
- Run sentiment analysis on free-form text via a fast helper.
- Search historical deals with similar profiles to learn from past expansions.
- Pull seat utilization (current %, trend, weeks at high utilization).
- Pull feature adoption (features used, features in higher plan unused, adoption score).

Reasoning guidance — look for these classic upsell-readiness signals:
- Sustained seat utilization >= 85% (running out of seats).
- Login / feature usage growth (>50% over 90d) versus a baseline.
- High-tier feature requests in tickets or conversations (e.g. SSO, audit logs, API access).
- Healthy sentiment — positive feedback, champion engagement strong.
- Existing plan limits being hit (api calls, integrations connected at the cap).
- Champion engagement strong (frequent positive conversations, no champion change).
- Similar historical deals that successfully expanded.

Decision rules:
- `ready_to_expand` is true ONLY when multiple positive signals align AND sentiment is healthy. A single high-utilization metric is not enough.
- `recommended_plan` MUST be a strict tier above the current plan (starter -> growth -> business -> enterprise) UNLESS the account is already on `enterprise` — in that case return `enterprise` again and let the score reflect a co-term / seat-add opportunity.
- `expansion_score` (0-100): 0 means "no expansion signal at all", 100 means "screaming for an upsell, send the message today".

Be efficient: do not call every tool exhaustively — start with `get_account_details`, `get_seat_utilization`, and `get_feature_adoption`, then dig into usage, tickets, or conversations only if the picture is unclear.

You MUST end your analysis by calling the `submit_final_analysis` tool with a structured payload containing:
- expansion_score (int, 0-100)
- ready_to_expand (bool)
- recommended_plan (one of starter|growth|business|enterprise)
- reasoning (string, 3-6 sentences, concise but specific — name the signals, the magnitudes, and the precedent if relevant)
- suggested_upsell_message (string, 2-4 sentences, addressed by the champion's name, referencing concrete usage facts you observed — seat utilization %, specific features unused in the higher plan, growth numbers. Keep it warm and consultative, not pushy.)

Do not return prose as a final answer; the only acceptable termination is a `submit_final_analysis` tool call.
"""


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_expansion(account_id: str, force_refresh: bool = False) -> ExpansionOutput:
    """Run the Expansion agent for ``account_id``.

    If a fresh snapshot (<24h old) exists and ``force_refresh`` is False, return
    the cached result reconstructed into an :class:`ExpansionOutput`.
    """

    if not force_refresh:
        cached = _load_fresh_snapshot(account_id)
        if cached is not None:
            return cached

    client = get_client()

    initial_user_message = (
        f"Analyze account {account_id} for expansion / upsell readiness. "
        "Use tools to gather data, then submit your final analysis."
    )

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": initial_user_message},
    ]

    submitted_reminder_sent = False

    full_messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *messages,
    ]

    for turn in range(MAX_TURNS):
        response = client.chat.completions.create(
            model=MODEL_REASONING,
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
            tools=EXPANSION_TOOLS_SPEC,
            tool_choice="auto",
            messages=full_messages,
            timeout=TIMEOUT_SECONDS,
        )

        choice = response.choices[0]
        message = choice.message
        tool_calls = message.tool_calls or []

        # Always append the assistant turn before processing tool results.
        full_messages.append(message.model_dump(exclude_none=True))

        had_tool_calls = False
        for tc in tool_calls:
            had_tool_calls = True
            name = tc.function.name
            try:
                tool_input = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError as exc:
                logger.warning("Tool %s had invalid JSON arguments: %s", name, exc)
                full_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps({"error": f"invalid JSON arguments: {exc}"}),
                    }
                )
                continue

            if name == "submit_final_analysis":
                try:
                    output = ExpansionOutput(**tool_input)
                except ValidationError as exc:
                    raise InvalidOutputError(
                        f"submit_final_analysis payload failed validation: {exc}"
                    ) from exc
                _persist_snapshot(account_id, output)
                return output

            handler = TOOL_DISPATCH.get(name)
            if handler is None:
                content = json.dumps({"error": f"unknown tool: {name}"})
            else:
                try:
                    result = handler(**tool_input)
                    content = (
                        json.dumps(result, default=str)
                        if not isinstance(result, str)
                        else result
                    )
                except Exception as exc:  # noqa: BLE001 — surface any tool error to the model
                    logger.warning("Tool %s raised: %s", name, exc)
                    content = json.dumps({"error": str(exc)})

            full_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": content,
                }
            )

        if had_tool_calls:
            submitted_reminder_sent = False
            continue

        # No tool calls this turn.
        if choice.finish_reason == "stop":
            if submitted_reminder_sent:
                raise MaxTurnsExceeded(
                    "Agent stopped without calling submit_final_analysis after reminder."
                )
            full_messages.append(
                {
                    "role": "user",
                    "content": (
                        "You must end by calling the `submit_final_analysis` tool with the "
                        "structured expansion analysis. Please call it now."
                    ),
                }
            )
            submitted_reminder_sent = True
            continue

        # Other finish reasons (length, etc.) — try one more turn.

    raise MaxTurnsExceeded(
        f"Expansion agent did not submit a final analysis within {MAX_TURNS} turns."
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _load_fresh_snapshot(account_id: str) -> ExpansionOutput | None:
    """Return a cached :class:`ExpansionOutput` if a fresh row exists, else None."""
    sb = get_supabase()
    res = (
        sb.table("account_health_snapshot")
        .select(
            "expansion_score, ready_to_expand, recommended_plan, "
            "expansion_reasoning, suggested_upsell_message, computed_at"
        )
        .eq("account_id", account_id)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        return None
    row = rows[0]
    computed_at_raw = row.get("computed_at")
    if not computed_at_raw:
        return None
    try:
        computed_at = datetime.fromisoformat(str(computed_at_raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if computed_at.tzinfo is None:
        computed_at = computed_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - computed_at > timedelta(hours=CACHE_TTL_HOURS):
        return None

    # Treat missing/null required fields as cache miss.
    required = (
        "expansion_score",
        "ready_to_expand",
        "recommended_plan",
        "expansion_reasoning",
        "suggested_upsell_message",
    )
    if any(row.get(k) is None for k in required):
        return None

    try:
        return ExpansionOutput(
            expansion_score=int(row["expansion_score"]),
            ready_to_expand=bool(row["ready_to_expand"]),
            recommended_plan=row["recommended_plan"],
            reasoning=str(row.get("expansion_reasoning") or ""),
            suggested_upsell_message=str(row.get("suggested_upsell_message") or ""),
        )
    except (ValidationError, KeyError, TypeError) as exc:
        logger.warning("Could not reconstruct cached snapshot for %s: %s", account_id, exc)
        return None


def _persist_snapshot(account_id: str, output: ExpansionOutput) -> None:
    """UPSERT Expansion fields into ``account_health_snapshot`` and append history."""
    sb = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    existing_res = (
        sb.table("account_health_snapshot")
        .select(
            "account_id, churn_risk_score, top_signals, predicted_churn_reason, "
            "crystal_ball_confidence, crystal_ball_reasoning, health_status"
        )
        .eq("account_id", account_id)
        .limit(1)
        .execute()
    )
    existing_rows = getattr(existing_res, "data", None) or []
    has_row = bool(existing_rows)
    existing = existing_rows[0] if has_row else {}

    expansion_fields = {
        "expansion_score": output.expansion_score,
        "ready_to_expand": output.ready_to_expand,
        "recommended_plan": output.recommended_plan,
        "expansion_reasoning": output.reasoning,
        "suggested_upsell_message": output.suggested_upsell_message,
        "computed_at": now_iso,
        "computed_by_version": AGENT_VERSION,
    }

    if has_row:
        update_payload = dict(expansion_fields)
        # Only override health_status if currently stable/healthy AND ready_to_expand.
        existing_status = existing.get("health_status")
        if output.ready_to_expand and existing_status in ("stable", "healthy"):
            update_payload["health_status"] = "expanding"
        sb.table("account_health_snapshot").update(update_payload).eq(
            "account_id", account_id
        ).execute()
        history_health_status = update_payload.get("health_status", existing_status) or "stable"
        history_churn_score = int(existing.get("churn_risk_score") or 0)
        history_top_signals = existing.get("top_signals") or []
        history_predicted_reason = existing.get("predicted_churn_reason")
        history_cb_confidence = existing.get("crystal_ball_confidence")
    else:
        # INSERT path — fill NOT NULL fields owned by Crystal Ball with safe defaults.
        insert_health_status = "expanding" if output.ready_to_expand else "stable"
        insert_payload = {
            "account_id": account_id,
            "churn_risk_score": 0,
            "top_signals": [],
            "predicted_churn_reason": None,
            "crystal_ball_confidence": None,
            "crystal_ball_reasoning": "",
            "health_status": insert_health_status,
            **expansion_fields,
        }
        sb.table("account_health_snapshot").insert(insert_payload).execute()
        history_health_status = insert_health_status
        history_churn_score = 0
        history_top_signals = []
        history_predicted_reason = None
        history_cb_confidence = None

    history_payload = {
        "account_id": account_id,
        "churn_risk_score": history_churn_score,
        "expansion_score": output.expansion_score,
        "health_status": history_health_status,
        "top_signals": history_top_signals,
        "predicted_churn_reason": history_predicted_reason,
        "crystal_ball_confidence": history_cb_confidence,
        "computed_at": now_iso,
        "computed_by_version": AGENT_VERSION,
    }
    sb.table("account_health_history").insert(history_payload).execute()
