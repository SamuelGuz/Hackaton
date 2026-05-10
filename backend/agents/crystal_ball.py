"""Crystal Ball agent — autonomous tool-calling loop that produces a churn risk
analysis for a B2B SaaS account and persists it to ``account_health_snapshot``.

Implements the contract defined in CONTRACTS.md sections 2.2 and 2.5.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from backend.agents.tools import TOOLS_SPEC, TOOL_DISPATCH
from backend.shared.openai_client import MODEL_REASONING, get_client
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_VERSION = "crystal-ball-v1.0"
MAX_TURNS = 10
MAX_TOKENS = 4096
TEMPERATURE = 0.3
TIMEOUT_SECONDS = 60

CACHE_TTL_HOURS = 24


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class CrystalBallError(Exception):
    """Base exception for Crystal Ball agent errors."""


class MaxTurnsExceeded(CrystalBallError):
    """Raised when the agent exhausts MAX_TURNS without submitting a final analysis."""


class InvalidOutputError(CrystalBallError):
    """Raised when the agent submits a final analysis that fails schema validation."""


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


Severity = Literal["low", "medium", "high"]


class Signal(BaseModel):
    signal: str
    value: Any
    severity: Severity


class CrystalBallOutput(BaseModel):
    churn_risk_score: int = Field(..., ge=0, le=100)
    top_signals: list[Signal]
    predicted_churn_reason: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    reasoning: str


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = """You are the Crystal Ball Agent for Acme SaaS Inc., a B2B SaaS company.

Your job: analyze a single customer account and produce a churn risk score from 0 to 100, where 0 means "this customer is thriving and unlikely to churn" and 100 means "this customer is on the verge of churning".

You operate autonomously by calling tools to gather evidence before reaching a conclusion. The tools available let you:
- Pull account fundamentals (industry, size, plan, ARR, contract renewal date, champion).
- Pull usage events (logins, feature use, sessions) over time.
- Pull support tickets with sentiment.
- Pull recent conversations (emails, calls, slack) with sentiment.
- Run sentiment analysis on free-form text via a fast helper.
- Search historical deals with similar profiles to learn from past wins/losses.

Reasoning guidance — look for these classic pre-churn signals:
- Sustained drops in logins / active sessions versus a 4-12 week baseline.
- Negative-sentiment support tickets, especially unresolved ones.
- Champion changes or champion disengagement (gaps in conversations, escalating tone).
- Low seat utilization relative to seats purchased (customer is not getting value).
- Proximity to contract renewal combined with any of the above.
- NPS detractor scores or worsening NPS trend.

Be efficient: do not call every tool exhaustively — start with account details and the most informative usage/ticket data, then dig deeper only if signals are ambiguous.

Severity rubric for each signal:
- "high": signal is unambiguous and directly tied to churn (e.g. logins down >50%, multiple unresolved negative tickets, champion left).
- "medium": signal is concerning but not decisive on its own.
- "low": noted but minor.

Confidence rubric (0.0-1.0):
- High (>=0.8): rich data, multiple consistent signals, similar historical precedent.
- Medium (0.5-0.79): some data, signals partially aligned.
- Low (<0.5): sparse data or conflicting signals.

You MUST end your analysis by calling the `submit_final_analysis` tool with a structured payload containing:
- churn_risk_score (int, 0-100)
- top_signals (array of {signal, value, severity})
- predicted_churn_reason (string)
- confidence (float, 0.0-1.0)
- reasoning (string, 3-6 sentences, concise but specific — name the signals, the magnitudes, and the precedent if relevant)

Do not return prose as a final answer; the only acceptable termination is a `submit_final_analysis` tool call.
"""


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_crystal_ball(account_id: str, force_refresh: bool = False) -> CrystalBallOutput:
    """Run the Crystal Ball agent for ``account_id``.

    If a fresh snapshot (<24h old) exists and ``force_refresh`` is False, return
    the cached result reconstructed into a :class:`CrystalBallOutput`.
    """

    if not force_refresh:
        cached = _load_fresh_snapshot(account_id)
        if cached is not None:
            return cached

    client = get_client()

    initial_user_message = (
        f"Analyze account {account_id}. Use tools to gather data, then submit your final analysis."
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
            tools=TOOLS_SPEC,
            tool_choice="auto",
            messages=full_messages,
            timeout=TIMEOUT_SECONDS,
        )

        choice = response.choices[0]
        message = choice.message
        tool_calls = message.tool_calls or []

        # Always append the assistant turn before processing tool results.
        full_messages.append(message.model_dump(exclude_none=True))

        # Process tool calls in this turn.
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
                    output = CrystalBallOutput(**tool_input)
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
                # Already nudged once; the model still refuses to call the tool.
                raise MaxTurnsExceeded(
                    "Agent stopped without calling submit_final_analysis after reminder."
                )
            full_messages.append(
                {
                    "role": "user",
                    "content": (
                        "You must end by calling the `submit_final_analysis` tool with the "
                        "structured churn analysis. Please call it now."
                    ),
                }
            )
            submitted_reminder_sent = True
            continue

        # Other finish reasons (length, etc.) — try one more turn.

    raise MaxTurnsExceeded(
        f"Crystal Ball did not submit a final analysis within {MAX_TURNS} turns."
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _compute_health_status(score: int) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "at_risk"
    if score >= 40:
        return "stable"
    return "healthy"


def _load_fresh_snapshot(account_id: str) -> CrystalBallOutput | None:
    """Return a cached :class:`CrystalBallOutput` if a fresh row exists, else None."""
    sb = get_supabase()
    res = (
        sb.table("account_health_snapshot")
        .select(
            "churn_risk_score, top_signals, predicted_churn_reason, "
            "crystal_ball_confidence, crystal_ball_reasoning, computed_at"
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

    try:
        return CrystalBallOutput(
            churn_risk_score=row["churn_risk_score"],
            top_signals=row.get("top_signals") or [],
            predicted_churn_reason=row.get("predicted_churn_reason") or "",
            confidence=float(row.get("crystal_ball_confidence") or 0.0),
            reasoning=row.get("crystal_ball_reasoning") or "",
        )
    except (ValidationError, KeyError, TypeError) as exc:
        logger.warning("Could not reconstruct cached snapshot for %s: %s", account_id, exc)
        return None


def _persist_snapshot(account_id: str, output: CrystalBallOutput) -> None:
    """UPSERT Crystal Ball fields into ``account_health_snapshot`` and append history."""
    sb = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()
    health_status = _compute_health_status(output.churn_risk_score)
    top_signals_json = [s.model_dump() for s in output.top_signals]

    existing = (
        sb.table("account_health_snapshot")
        .select("account_id")
        .eq("account_id", account_id)
        .limit(1)
        .execute()
    )
    has_row = bool(getattr(existing, "data", None))

    if has_row:
        update_payload = {
            "churn_risk_score": output.churn_risk_score,
            "top_signals": top_signals_json,
            "predicted_churn_reason": output.predicted_churn_reason,
            "crystal_ball_confidence": output.confidence,
            "crystal_ball_reasoning": output.reasoning,
            "health_status": health_status,
            "computed_at": now_iso,
            "computed_by_version": AGENT_VERSION,
        }
        sb.table("account_health_snapshot").update(update_payload).eq(
            "account_id", account_id
        ).execute()
    else:
        insert_payload = {
            "account_id": account_id,
            "churn_risk_score": output.churn_risk_score,
            "top_signals": top_signals_json,
            "predicted_churn_reason": output.predicted_churn_reason,
            "crystal_ball_confidence": output.confidence,
            "crystal_ball_reasoning": output.reasoning,
            "expansion_score": 0,
            "ready_to_expand": False,
            "recommended_plan": None,
            "expansion_reasoning": None,
            "suggested_upsell_message": None,
            "health_status": health_status,
            "computed_at": now_iso,
            "computed_by_version": AGENT_VERSION,
        }
        sb.table("account_health_snapshot").insert(insert_payload).execute()

    # Append-only history row.
    history_payload = {
        "account_id": account_id,
        "churn_risk_score": output.churn_risk_score,
        "expansion_score": 0,
        "health_status": health_status,
        "top_signals": top_signals_json,
        "predicted_churn_reason": output.predicted_churn_reason,
        "crystal_ball_confidence": output.confidence,
        "computed_at": now_iso,
        "computed_by_version": AGENT_VERSION,
    }
    sb.table("account_health_history").insert(history_payload).execute()
