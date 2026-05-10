"""Learning loop — closed-loop feedback into playbook_memory.

When a playbook's success_rate falls below a threshold after a minimum number
of uses, this module asks an LLM to design an improved variant (v+1), persists
it as a fresh row, and links the dying playbook via ``superseded_by``.

Public API:
    regenerate_playbook_if_failing(playbook_id) -> dict | None
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from backend.shared.openai_client import MODEL_REASONING, get_client
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)


REGEN_MIN_TIMES_USED = 5
REGEN_MAX_SUCCESS_RATE = 0.30
REGEN_LOOKBACK_INTERVENTIONS = 8
REGEN_MODEL = MODEL_REASONING
REGEN_TEMPERATURE = 0.6  # higher than Engine — encourage variation
REGEN_MAX_TOKENS = 1500


class _RegenOutput(BaseModel):
    recommended_channel: Literal["email", "whatsapp", "voice_call"]
    message_template: str = Field(..., min_length=20)
    reasoning_template: str = Field(..., min_length=20)
    rationale: str = Field(..., min_length=20)


SYSTEM_PROMPT = """You are the Playbook Regenerator for Churn Oracle's Learning Loop.

A playbook has been failing — success_rate < 30% over multiple uses. Your job: design an improved variant (version N+1) that has a real chance of outperforming the dying playbook.

You receive:
- The failing playbook (channel, message template, reasoning, account profile target, signal pattern target, success_rate, times_used)
- The last several interventions that used it (channel, recipient, message body, status, outcome, customer reply if any)

Your output is a NEW playbook. It should target the SAME account_profile and signal_pattern (the audience hasn't changed) but try a different angle:

Possible improvements (pick ONE primary change, optionally one secondary):
- Switch channel: voice_call → whatsapp (lower friction), or email → voice_call (higher signal strength on critical accounts)
- Switch tone: salesy → consultative, formal → warmer, generic → specific
- Switch framing: solution-first → discovery-first, hypothesis → open question
- Switch timing reference: explicit deadline → no deadline, immediate → "next week"

CRITICAL CONSTRAINTS:
- recommended_channel MUST be one of: email | whatsapp | voice_call (never slack — that's internal-only).
- message_template MUST be a template (uses placeholders like {champion_name}, {top_signals[0].signal}, {predicted_churn_reason}). Don't write a finished message.
- reasoning_template explains WHEN to apply this playbook (target profile match logic).
- Reference at least one CONCRETE failure pattern from the interventions (e.g. "previous voice_call attempts went to voicemail every time").
- rationale explains in 2-3 sentences why this variant should outperform the dying one.

Output strict JSON:
{
  "recommended_channel": "...",
  "message_template": "...",
  "reasoning_template": "...",
  "rationale": "..."
}
"""


def regenerate_playbook_if_failing(playbook_id: str) -> dict[str, Any] | None:
    """If the playbook meets the failing threshold, generate a v+1 via LLM,
    persist it, link supersession, and return a summary dict.
    Returns None if regeneration was not triggered."""
    sb = get_supabase()

    # Step 1: load current playbook
    pb = sb.table("playbook_memory").select("*").eq("id", playbook_id).limit(1).execute()
    rows = getattr(pb, "data", None) or []
    if not rows:
        logger.warning("regen: playbook %s not found", playbook_id)
        return None
    current = rows[0]

    # Step 2: gate
    if current.get("superseded_by") is not None:
        return None
    times_used = int(current.get("times_used") or 0)
    success_rate = float(current.get("success_rate") or 0.0)
    if times_used < REGEN_MIN_TIMES_USED or success_rate >= REGEN_MAX_SUCCESS_RATE:
        return None

    logger.info(
        "regen: triggering for playbook %s (rate=%.2f used=%d)",
        playbook_id,
        success_rate,
        times_used,
    )

    # Step 3: load recent interventions that used this playbook
    iv_res = (
        sb.table("interventions")
        .select(
            "id, channel, recipient, message_body, status, outcome, outcome_notes, sent_at"
        )
        .eq("playbook_id_used", playbook_id)
        .order("created_at", desc=True)
        .limit(REGEN_LOOKBACK_INTERVENTIONS)
        .execute()
    )
    recent_interventions = getattr(iv_res, "data", None) or []

    # Step 4: build LLM prompt
    user_payload = {
        "failing_playbook": {
            "id": current["id"],
            "version": int(current.get("version") or 1),
            "recommended_channel": current.get("recommended_channel"),
            "message_template": current.get("message_template"),
            "reasoning_template": current.get("reasoning_template"),
            "account_profile": current.get("account_profile"),
            "signal_pattern": current.get("signal_pattern"),
            "success_rate": success_rate,
            "times_used": times_used,
            "times_succeeded": int(current.get("times_succeeded") or 0),
        },
        "recent_interventions": recent_interventions,
    }

    # Step 5: LLM call (single-shot, JSON mode)
    client = get_client()
    try:
        response = client.chat.completions.create(
            model=REGEN_MODEL,
            max_tokens=REGEN_MAX_TOKENS,
            temperature=REGEN_TEMPERATURE,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(user_payload, default=str)},
            ],
            timeout=45,
        )
    except Exception:
        logger.exception("regen: LLM call failed for %s", playbook_id)
        return None

    raw = response.choices[0].message.content or ""
    try:
        parsed = json.loads(raw)
        out = _RegenOutput(**parsed)
    except (json.JSONDecodeError, ValidationError):
        logger.exception("regen: invalid LLM output for %s: %s", playbook_id, raw[:200])
        return None

    # Step 6: persist new playbook (v+1, fresh stats, same audience)
    new_version = int(current.get("version") or 1) + 1
    new_payload = {
        "account_profile": current.get("account_profile"),
        "signal_pattern": current.get("signal_pattern"),
        "recommended_channel": out.recommended_channel,
        "message_template": out.message_template,
        "reasoning_template": out.reasoning_template,
        "times_used": 0,
        "times_succeeded": 0,
        "success_rate": 0.00,
        "version": new_version,
        "superseded_by": None,
    }
    insert_res = sb.table("playbook_memory").insert(new_payload).execute()
    inserted = (getattr(insert_res, "data", None) or [None])[0]
    if not inserted:
        logger.warning(
            "regen: insert returned no data for new playbook (parent=%s)", playbook_id
        )
        return None
    new_id = inserted["id"]

    # Step 7: link old → new (mark superseded)
    sb.table("playbook_memory").update({
        "superseded_by": new_id,
    }).eq("id", playbook_id).execute()

    summary: dict[str, Any] = {
        "regenerated": True,
        "old_playbook_id": playbook_id,
        "new_playbook_id": new_id,
        "old_version": int(current.get("version") or 1),
        "new_version": new_version,
        "old_success_rate": success_rate,
        "old_times_used": times_used,
        "channel_change": out.recommended_channel != current.get("recommended_channel"),
        "old_channel": current.get("recommended_channel"),
        "new_channel": out.recommended_channel,
        "rationale": out.rationale,
    }
    logger.info(
        "regen: created %s -> %s (%s -> %s)",
        playbook_id,
        new_id,
        current.get("recommended_channel"),
        out.recommended_channel,
    )
    return summary
