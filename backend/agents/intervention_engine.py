"""Intervention Engine — single-shot LLM call that decides the next outbound
action for an account.

Implements the contract defined in CONTRACTS.md sections 2.2 and 2.5.7.

Public API:
    run_intervention(account_id, trigger_reason) -> InterventionOutput
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from backend.shared.openai_client import MODEL_REASONING, get_client
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_VERSION = "intervention-engine-v1.0"
MODEL = MODEL_REASONING  # gpt-4o
MAX_TOKENS = 2048
TEMPERATURE = 0.4
TIMEOUT_SECONDS = 30

COOL_OFF_HOURS = 72
PLAYBOOK_REPEAT_BLOCK_DAYS = 14

# Bloqueo duro: no crear una nueva fila si ya hay una intervención en ciclo (CONTRACTS.md `interventions.status`).
_OPEN_INTERVENTION_STATUSES = frozenset(
    {
        "pending_approval",
        "pending",
        "sent",
        "delivered",
        "opened",
        "responded",
    }
)
PLAYBOOK_TOP_K = 5
PLAYBOOK_OVERRIDE_MIN_SUCCESS = 0.70
PLAYBOOK_OVERRIDE_MIN_USES = 5
APPROVAL_ARR_THRESHOLD = 25000
APPROVAL_BIG_SAVE_ARR = 50000
APPROVAL_MIN_CONFIDENCE = 0.75

# Estados no-terminales: si existe una intervención del account con alguno de estos,
# no se debe crear una nueva (defensa en profundidad contra duplicados causados por
# races / dobles disparos del frontend). Terminales = `rejected`, `failed`, o
# cualquier fila con outcome != null.
OPEN_INTERVENTION_STATUSES: tuple[str, ...] = (
    "pending_approval",
    "pending",
    "sent",
    "delivered",
    "opened",
    "responded",
)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class InterventionError(Exception):
    """Base exception for the Intervention Engine."""


class CoolOffActive(InterventionError):
    """Raised when a cool-off / repeat-block rule prevents firing now (HTTP 409)."""


class AccountNotFound(InterventionError):
    """Raised when the account_id does not exist (HTTP 404)."""


class SnapshotMissing(InterventionError):
    """Raised when there is no account_health_snapshot — Crystal Ball / Expansion
    must run first (HTTP 409)."""


class InvalidOutputError(InterventionError):
    """Raised when the LLM output fails schema validation (HTTP 500)."""


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


Channel = Literal["email", "slack", "whatsapp", "voice_call"]


class InterventionOutput(BaseModel):
    intervention_id: str | None = None
    account_id: str
    trigger_reason: str
    recommended_channel: Channel
    recipient: str
    message_subject: str | None
    message_body: str
    playbook_id_used: str | None
    playbook_success_rate_at_decision: float | None
    agent_reasoning: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    requires_approval: bool
    approval_reasoning: str
    status: Literal["pending", "pending_approval"]
    auto_approved: bool


class _LLMOutput(BaseModel):
    """Subset of fields owned by the LLM."""

    message_subject: str | None = None
    message_body: str
    playbook_id_used: str | None = None
    playbook_success_rate_at_decision: float | None = None
    agent_reasoning: str
    confidence: float = Field(..., ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = """You are the Intervention Engine for Acme SaaS Inc.

Your job: given an account's current health snapshot, its profile, the past playbooks that worked for similar accounts, and the recent intervention/conversation history, decide the EXACT message to send. Channel is already picked by deterministic rules and given to you. Recipient is also given.

CRITICAL RULES:
- Use ONLY facts present in the input data. No invented numbers, no hallucinated features. Cite at least one specific signal from top_signals or one specific fact from the account row.
- Tone: investigative, curious, helpful — never accusatory or salesy. Don't say "you're at risk of churning". Do say "noticed [specific signal], wanted to understand if [hypothesis from predicted_churn_reason]".
- Channel intent:
  - email -> SOLUTION mode: present hypothesis + propose a concrete solution + ask a closeable yes/no question (e.g. "would Tuesday at 2pm work?"). Subject line <=60 chars, no spammy words, no caps, no emoji.
  - voice_call / whatsapp -> DISCOVERY mode: open-ended question to understand what's happening. No solution proposed yet. Subject is null.
- Length:
  - email body 60-120 words.
  - whatsapp 25-40 words.
  - voice_call script 30-45 seconds spoken (~80-110 words).
- Address by champion's first name. Sign off with csm_assigned's first name.
- Banned phrases: "Hope this finds you well", "I wanted to reach out", "Just checking in", "URGENT", "ACTION REQUIRED", "Last chance".

Output strict JSON with this schema:
{
  "message_subject": string | null,
  "message_body": string,
  "playbook_id_used": string | null,
  "playbook_success_rate_at_decision": number | null,
  "agent_reasoning": string,
  "confidence": number
}
"""


# ---------------------------------------------------------------------------
# Helpers — DB loaders
# ---------------------------------------------------------------------------


def _load_account(account_id: str) -> dict[str, Any]:
    sb = get_supabase()
    res = sb.table("accounts").select("*").eq("id", account_id).limit(1).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise AccountNotFound(f"account {account_id} not found")
    account = rows[0]

    # Resolve csm name via csm_team join (best effort).
    csm_id = account.get("csm_id")
    if csm_id:
        try:
            csm_res = (
                sb.table("csm_team")
                .select("name, email, slack_handle, phone")
                .eq("id", csm_id)
                .limit(1)
                .execute()
            )
            csm_rows = getattr(csm_res, "data", None) or []
            if csm_rows:
                account["csm_assigned"] = csm_rows[0].get("name")
                account["_csm"] = csm_rows[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not load csm_team row for %s: %s", csm_id, exc)
    return account


def _load_snapshot(account_id: str) -> dict[str, Any]:
    sb = get_supabase()
    res = (
        sb.table("account_health_snapshot")
        .select("*")
        .eq("account_id", account_id)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        raise SnapshotMissing(
            f"no account_health_snapshot for {account_id}; run Crystal Ball / Expansion first"
        )
    return rows[0]


def _load_recent_interventions(account_id: str, limit: int = 3) -> list[dict[str, Any]]:
    sb = get_supabase()
    res = (
        sb.table("interventions")
        .select(
            "id, channel, message_body, sent_at, created_at, outcome, responded_at, "
            "playbook_id_used, status"
        )
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return getattr(res, "data", None) or []


def _load_recent_conversations(account_id: str, limit: int = 5) -> list[dict[str, Any]]:
    sb = get_supabase()
    res = (
        sb.table("conversations")
        .select("channel, direction, sentiment, content, occurred_at")
        .eq("account_id", account_id)
        .order("occurred_at", desc=True)
        .limit(limit)
        .execute()
    )
    return getattr(res, "data", None) or []


# ---------------------------------------------------------------------------
# Cool-off / repeat guard
# ---------------------------------------------------------------------------


def _assert_no_open_intervention(account_id: str) -> None:
    """Raise CoolOffActive if an in-flight intervention row already exists."""
    sb = get_supabase()
    res = (
        sb.table("interventions")
        .select("id,status")
        .eq("account_id", account_id)
        .in_("status", list(_OPEN_INTERVENTION_STATUSES))
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if rows:
        st = rows[0].get("status")
        raise CoolOffActive(
            f"open intervention exists for account_id={account_id}, status={st!s}"
        )


def _parse_ts(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _check_cool_off(account_id: str, top_playbook_id: str | None) -> None:
    """Enforce open-row guard + same-account 72h cool-off + 14-day playbook block."""
    sb = get_supabase()

    # Hard guard: si ya hay una intervención no-terminal para esta cuenta, no se crea
    # otra. Esto cubre el caso donde el frontend dispara dos POSTs en paralelo
    # (StrictMode dev / doble click) y el time-based cool-off de abajo no llega a
    # bloquear el segundo a tiempo.
    open_res = (
        sb.table("interventions")
        .select("id, status")
        .eq("account_id", account_id)
        .in_("status", list(OPEN_INTERVENTION_STATUSES))
        .limit(1)
        .execute()
    )
    open_rows = getattr(open_res, "data", None) or []
    if open_rows:
        row = open_rows[0]
        raise CoolOffActive(
            f"open_intervention_exists id={row.get('id')} status={row.get('status')}"
        )

    # 72h cool-off based on the most recent intervention.
    last_res = (
        sb.table("interventions")
        .select("sent_at, created_at, status, outcome")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    last_rows = getattr(last_res, "data", None) or []
    if last_rows:
        last = last_rows[0]
        ref_ts = _parse_ts(last.get("sent_at")) or _parse_ts(last.get("created_at"))
        outcome = last.get("outcome")
        unresolved = outcome in (None, "pending", "no_response")
        if ref_ts is not None and unresolved:
            age = datetime.now(timezone.utc) - ref_ts
            if age < timedelta(hours=COOL_OFF_HOURS):
                age_hours = age.total_seconds() / 3600.0
                raise CoolOffActive(
                    f"last intervention {age_hours:.1f}h ago, "
                    f"status={last.get('status')!s}"
                )

    # Same-account 14-day playbook repeat block.
    if top_playbook_id:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=PLAYBOOK_REPEAT_BLOCK_DAYS)
        ).isoformat()
        rep_res = (
            sb.table("interventions")
            .select("id, created_at")
            .eq("account_id", account_id)
            .eq("playbook_id_used", top_playbook_id)
            .gte("created_at", cutoff)
            .limit(1)
            .execute()
        )
        if getattr(rep_res, "data", None):
            raise CoolOffActive(
                f"playbook {top_playbook_id} already used for this account "
                f"in the last {PLAYBOOK_REPEAT_BLOCK_DAYS} days"
            )


# ---------------------------------------------------------------------------
# Playbook selection
# ---------------------------------------------------------------------------


def _profile_match_score(profile: dict[str, Any], account: dict[str, Any]) -> float:
    """Crude overlap score over (industry, size, plan, arr_range). Range 0..1."""
    if not isinstance(profile, dict):
        return 0.0

    matches = 0
    total = 0

    for key in ("industry", "size", "plan"):
        allowed = profile.get(key)
        if allowed is None:
            continue
        total += 1
        acc_val = account.get(key)
        if isinstance(allowed, list):
            if acc_val in allowed:
                matches += 1
        elif allowed == acc_val:
            matches += 1

    arr_range = profile.get("arr_range")
    if isinstance(arr_range, list) and len(arr_range) == 2:
        total += 1
        try:
            lo, hi = float(arr_range[0]), float(arr_range[1])
            arr = float(account.get("arr_usd") or 0)
            if lo <= arr <= hi:
                matches += 1
        except (TypeError, ValueError):
            pass

    if total == 0:
        return 0.0
    return matches / total


def _select_top_playbooks(
    account: dict[str, Any],
    snapshot: dict[str, Any],  # noqa: ARG001 — reserved for signal_pattern matching
    trigger_reason: str,
    k: int = PLAYBOOK_TOP_K,
) -> list[dict[str, Any]]:
    sb = get_supabase()
    try:
        res = sb.table("playbook_memory").select("*").execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("playbook_memory query failed: %s", exc)
        return []
    rows = getattr(res, "data", None) or []
    if not rows:
        return []

    scored: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        profile = row.get("account_profile") or {}
        # Optional trigger filter — match if profile.trigger references trigger_reason.
        prof_trigger = profile.get("trigger") if isinstance(profile, dict) else None
        if prof_trigger is not None:
            if isinstance(prof_trigger, list):
                if trigger_reason not in prof_trigger:
                    continue
            elif prof_trigger != trigger_reason:
                continue

        # Skip superseded playbooks.
        if row.get("superseded_by"):
            continue

        profile_score = _profile_match_score(profile if isinstance(profile, dict) else {}, account)
        success_rate = float(row.get("success_rate") or 0.0)
        times_used = int(row.get("times_used") or 0)
        # success_rate * sqrt(times_used) — penalize low-sample.
        evidence = success_rate * math.sqrt(max(times_used, 0))
        # Combine with profile match (additive — both matter).
        score = evidence + profile_score
        scored.append((score, row))

    if not scored:
        return []

    scored.sort(
        key=lambda t: (t[0], int(t[1].get("version") or 0)),
        reverse=True,
    )
    return [row for _, row in scored[:k]]


# ---------------------------------------------------------------------------
# Channel selection
# ---------------------------------------------------------------------------


def _high_severity_count(snapshot: dict[str, Any]) -> int:
    signals = snapshot.get("top_signals") or []
    if not isinstance(signals, list):
        return 0
    count = 0
    for s in signals:
        if isinstance(s, dict) and s.get("severity") == "high":
            count += 1
    return count


def _select_channel(
    snapshot: dict[str, Any],
    account: dict[str, Any],
    last_interventions: list[dict[str, Any]],
    top_playbook: dict[str, Any] | None,
) -> tuple[Channel, str]:
    """Return ``(channel, channel_reason)`` per the deterministic ladder."""
    arr = float(account.get("arr_usd") or 0)
    health = snapshot.get("health_status")
    expansion_ready = bool(snapshot.get("ready_to_expand"))
    high_sev = _high_severity_count(snapshot)
    champion_changed = bool(account.get("champion_changed_recently"))

    # Trigger inferred from snapshot (used to drive expansion vs churn rungs).
    trigger_is_expansion = expansion_ready and health != "critical"

    last_channel: str | None = None
    last_outcome: str | None = None
    if last_interventions:
        last_channel = last_interventions[0].get("channel")
        last_outcome = last_interventions[0].get("outcome")

    def _blocked(ch: str) -> bool:
        return ch == last_channel and last_outcome == "no_response"

    # Rule 1 — playbook override.
    if top_playbook is not None:
        sr = float(top_playbook.get("success_rate") or 0.0)
        tu = int(top_playbook.get("times_used") or 0)
        if (
            sr >= PLAYBOOK_OVERRIDE_MIN_SUCCESS
            and tu >= PLAYBOOK_OVERRIDE_MIN_USES
        ):
            ch = top_playbook.get("recommended_channel")
            if ch in ("email", "whatsapp", "voice_call") and not _blocked(ch):
                pid = top_playbook.get("id", "?")
                return ch, f"rule_1_playbook_override:{pid}"

    # Rule 3 — critical + ARR >= 50k.
    if health == "critical" and arr >= APPROVAL_BIG_SAVE_ARR and not _blocked("voice_call"):
        return "voice_call", "rule_3_critical_high_arr"

    # Rule 4 — champion changed recently.
    if champion_changed and not _blocked("voice_call"):
        return "voice_call", "rule_4_champion_changed"

    # Rule 5 — critical + ARR < 50k.
    if health == "critical" and not _blocked("whatsapp"):
        return "whatsapp", "rule_5_critical_low_arr"

    # Rule 6 — at_risk + signals ambiguous (<2 high).
    if health == "at_risk" and high_sev < 2 and not _blocked("whatsapp"):
        return "whatsapp", "rule_6_at_risk_ambiguous"

    # Rule 7 — at_risk + signals clear.
    if health == "at_risk" and high_sev >= 2 and not _blocked("email"):
        return "email", "rule_7_at_risk_clear_signals"

    # Rule 8 — expansion_ready + ARR >= 50k.
    if trigger_is_expansion and arr >= APPROVAL_BIG_SAVE_ARR and not _blocked("voice_call"):
        return "voice_call", "rule_8_expansion_high_arr"

    # Rule 9 — expansion_ready + ARR < 50k.
    if trigger_is_expansion and not _blocked("email"):
        return "email", "rule_9_expansion_low_arr"

    # Rule 10 — default email (with last-resort fallback if blocked).
    if not _blocked("email"):
        return "email", "rule_10_default_email"
    # If email is blocked too, fall back to whatsapp, then voice_call.
    for fallback in ("whatsapp", "voice_call"):
        if not _blocked(fallback):
            return fallback, f"rule_10_default_blocked_fallback_{fallback}"  # type: ignore[return-value]
    return "email", "rule_10_default_all_blocked_force_email"


# ---------------------------------------------------------------------------
# Recipient resolution
# ---------------------------------------------------------------------------


def _resolve_recipient(channel: Channel, account: dict[str, Any]) -> str:
    if channel == "email":
        email = account.get("champion_email")
        if not email:
            raise InterventionError("no_recipient")
        return email
    if channel in ("voice_call", "whatsapp"):
        phone = account.get("champion_phone")
        if phone:
            return phone
        raise InterventionError("no_phone")
    raise InterventionError(f"unknown channel {channel}")


def _resolve_with_downgrade(
    initial_channel: Channel, account: dict[str, Any]
) -> tuple[Channel, str, str | None]:
    """Try the initial channel; if its recipient is missing, downgrade to email.

    Returns ``(final_channel, recipient, downgrade_note | None)``.
    """
    try:
        recipient = _resolve_recipient(initial_channel, account)
        return initial_channel, recipient, None
    except InterventionError as exc:
        if initial_channel == "email":
            raise
        logger.warning(
            "downgrading channel %s -> email (%s)", initial_channel, exc
        )
        email = account.get("champion_email")
        if not email:
            raise InterventionError("no_recipient") from exc
        note = (
            f"channel downgraded {initial_channel}->email: "
            f"missing {initial_channel} recipient field on account"
        )
        return "email", email, note


# ---------------------------------------------------------------------------
# Confidence clamping
# ---------------------------------------------------------------------------


def _clamp_confidence(
    confidence: float,
    playbook_id_used: str | None,
    last_interventions: list[dict[str, Any]],
) -> tuple[float, list[str]]:
    notes: list[str] = []
    out = confidence

    if playbook_id_used is None and out > 0.60:
        out = 0.60
        notes.append("confidence clamped to 0.60 (no playbook used)")

    if len(last_interventions) >= 2:
        last_two = last_interventions[:2]
        if all(li.get("outcome") == "no_response" for li in last_two):
            if out > 0.50:
                out = 0.50
                notes.append(
                    "confidence clamped to 0.50 (last 2 interventions = no_response)"
                )

    return out, notes


# ---------------------------------------------------------------------------
# Approval rule
# ---------------------------------------------------------------------------


def _compute_approval(
    channel: Channel,
    account: dict[str, Any],
    confidence: float,
    trigger_reason: str,
) -> tuple[bool, str]:
    arr = float(account.get("arr_usd") or 0)
    fired: list[str] = []

    if channel in ("voice_call", "whatsapp"):
        fired.append(f"{channel} high-touch channel")
    if arr > APPROVAL_ARR_THRESHOLD:
        fired.append(
            f"ARR ${arr:,.0f} above ${APPROVAL_ARR_THRESHOLD:,} threshold"
        )
    if confidence < APPROVAL_MIN_CONFIDENCE:
        fired.append(
            f"confidence {confidence:.2f} below {APPROVAL_MIN_CONFIDENCE:.2f}"
        )
    if trigger_reason == "churn_risk_high" and arr > APPROVAL_BIG_SAVE_ARR:
        fired.append(
            f"churn-risk save on big account (ARR ${arr:,.0f} > ${APPROVAL_BIG_SAVE_ARR:,})"
        )

    if not fired:
        return False, "no approval rules triggered"
    return True, "; ".join(fired)


# ---------------------------------------------------------------------------
# Status resolution (consults system_settings)
# ---------------------------------------------------------------------------


def _load_setting(key: str) -> Any | None:
    sb = get_supabase()
    try:
        res = (
            sb.table("system_settings")
            .select("value")
            .eq("key", key)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("system_settings lookup failed for %s: %s", key, exc)
        return None
    rows = getattr(res, "data", None) or []
    if not rows:
        return None
    return rows[0].get("value")


def _resolve_status(
    requires_approval: bool, account: dict[str, Any], confidence: float
) -> tuple[Literal["pending", "pending_approval"], bool]:
    if not requires_approval:
        return "pending", False

    enabled = _load_setting("auto_approval_enabled")
    max_arr = _load_setting("auto_approval_max_arr_usd")
    min_conf = _load_setting("auto_approval_min_confidence")

    enabled_b = bool(enabled) if not isinstance(enabled, str) else enabled.lower() == "true"
    try:
        max_arr_n = float(max_arr) if max_arr is not None else 0.0
    except (TypeError, ValueError):
        max_arr_n = 0.0
    try:
        min_conf_n = float(min_conf) if min_conf is not None else 1.0
    except (TypeError, ValueError):
        min_conf_n = 1.0

    arr = float(account.get("arr_usd") or 0)

    if enabled_b and arr <= max_arr_n and confidence >= min_conf_n:
        return "pending", True
    return "pending_approval", False


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _persist_intervention(output: InterventionOutput) -> str:
    sb = get_supabase()
    payload = {
        "account_id": output.account_id,
        "trigger_reason": output.trigger_reason,
        "channel": output.recommended_channel,
        "recipient": output.recipient,
        "message_subject": output.message_subject,
        "message_body": output.message_body,
        "voice_audio_url": None,
        "playbook_id_used": output.playbook_id_used,
        "agent_reasoning": output.agent_reasoning,
        "confidence_score": output.confidence,
        "requires_approval": output.requires_approval,
        "auto_approved": output.auto_approved,
        "status": output.status,
    }
    res = sb.table("interventions").insert(payload).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise InterventionError("failed to persist intervention (no row returned)")
    new_id = rows[0].get("id")
    if not new_id:
        raise InterventionError("inserted intervention row has no id")
    return str(new_id)


# ---------------------------------------------------------------------------
# LLM call
# ---------------------------------------------------------------------------


def _build_user_payload(
    *,
    trigger_reason: str,
    channel: Channel,
    channel_reason: str,
    recipient: str,
    account: dict[str, Any],
    snapshot: dict[str, Any],
    candidate_playbooks: list[dict[str, Any]],
    last_interventions: list[dict[str, Any]],
    recent_conversations: list[dict[str, Any]],
) -> dict[str, Any]:
    account_block = {
        "industry": account.get("industry"),
        "size": account.get("size"),
        "plan": account.get("plan"),
        "arr_usd": float(account.get("arr_usd") or 0),
        "champion_name": account.get("champion_name"),
        "champion_role": account.get("champion_role"),
        "csm_assigned": account.get("csm_assigned"),
        "seats_active": account.get("seats_active"),
        "seats_purchased": account.get("seats_purchased"),
        "contract_renewal_date": account.get("contract_renewal_date"),
        "champion_changed_recently": account.get("champion_changed_recently"),
    }
    snap_block = {
        "churn_risk_score": snapshot.get("churn_risk_score"),
        "top_signals": snapshot.get("top_signals"),
        "predicted_churn_reason": snapshot.get("predicted_churn_reason"),
        "crystal_ball_reasoning": snapshot.get("crystal_ball_reasoning"),
        "expansion_score": snapshot.get("expansion_score"),
        "ready_to_expand": snapshot.get("ready_to_expand"),
        "recommended_plan": snapshot.get("recommended_plan"),
        "expansion_reasoning": snapshot.get("expansion_reasoning"),
        "suggested_upsell_message": snapshot.get("suggested_upsell_message"),
        "health_status": snapshot.get("health_status"),
    }
    pb_block = [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "recommended_channel": p.get("recommended_channel"),
            "template_message": p.get("message_template"),
            "success_rate": float(p.get("success_rate") or 0.0),
            "times_used": int(p.get("times_used") or 0),
            "version": p.get("version"),
            "signal_pattern": p.get("signal_pattern"),
        }
        for p in candidate_playbooks
    ]
    last_block = [
        {
            "channel": li.get("channel"),
            "message_body_excerpt": (li.get("message_body") or "")[:200],
            "sent_at": li.get("sent_at") or li.get("created_at"),
            "outcome": li.get("outcome"),
            "responded_at": li.get("responded_at"),
        }
        for li in last_interventions
    ]
    conv_block = [
        {
            "channel": c.get("channel"),
            "direction": c.get("direction"),
            "sentiment": c.get("sentiment"),
            "content_excerpt": (c.get("content") or "")[:200],
            "occurred_at": c.get("occurred_at"),
        }
        for c in recent_conversations
    ]
    return {
        "trigger_reason": trigger_reason,
        "channel_chosen": channel,
        "channel_reason": channel_reason,
        "recipient": recipient,
        "account": account_block,
        "snapshot": snap_block,
        "candidate_playbooks": pb_block,
        "last_interventions": last_block,
        "recent_conversations": conv_block,
    }


def _call_llm(user_payload: dict[str, Any]) -> _LLMOutput:
    client = get_client()
    user_content = json.dumps(user_payload, indent=2, default=str)
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        timeout=TIMEOUT_SECONDS,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    )
    content = response.choices[0].message.content or ""
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise InvalidOutputError(f"LLM did not return valid JSON: {exc}") from exc
    try:
        return _LLMOutput(**parsed)
    except ValidationError as exc:
        raise InvalidOutputError(
            f"LLM JSON failed schema validation: {exc}"
        ) from exc


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_intervention(account_id: str, trigger_reason: str) -> InterventionOutput:
    """Decide, persist, and return the next intervention for ``account_id``.

    Raises:
        AccountNotFound: account does not exist.
        SnapshotMissing: no health snapshot — run Crystal Ball / Expansion first.
        CoolOffActive: blocked by 72h or 14-day playbook repeat rules.
        InvalidOutputError: LLM returned malformed JSON / failed schema.
        InterventionError: other engine failures (e.g. no recipient available).
    """
    account = _load_account(account_id)
    snapshot = _load_snapshot(account_id)
    _assert_no_open_intervention(account_id)
    last_interventions = _load_recent_interventions(account_id)

    # Compute candidate playbooks first so we can apply the same-account
    # 14-day repeat block before doing anything else expensive.
    candidate_playbooks = _select_top_playbooks(
        account, snapshot, trigger_reason, k=PLAYBOOK_TOP_K
    )
    top_playbook = candidate_playbooks[0] if candidate_playbooks else None
    top_playbook_id = top_playbook.get("id") if top_playbook else None

    _check_cool_off(account_id, top_playbook_id)

    recent_conversations = _load_recent_conversations(account_id)

    initial_channel, channel_reason = _select_channel(
        snapshot, account, last_interventions, top_playbook
    )
    final_channel, recipient, downgrade_note = _resolve_with_downgrade(
        initial_channel, account
    )

    user_payload = _build_user_payload(
        trigger_reason=trigger_reason,
        channel=final_channel,
        channel_reason=channel_reason,
        recipient=recipient,
        account=account,
        snapshot=snapshot,
        candidate_playbooks=candidate_playbooks,
        last_interventions=last_interventions,
        recent_conversations=recent_conversations,
    )

    llm_out = _call_llm(user_payload)

    confidence, clamp_notes = _clamp_confidence(
        llm_out.confidence, llm_out.playbook_id_used, last_interventions
    )

    reasoning_parts = [llm_out.agent_reasoning, f"channel_rule={channel_reason}"]
    if downgrade_note:
        reasoning_parts.append(downgrade_note)
    reasoning_parts.extend(clamp_notes)
    agent_reasoning = " | ".join(p for p in reasoning_parts if p)

    requires_approval, approval_reasoning = _compute_approval(
        final_channel, account, confidence, trigger_reason
    )
    status, auto_approved = _resolve_status(requires_approval, account, confidence)

    output = InterventionOutput(
        account_id=account_id,
        trigger_reason=trigger_reason,
        recommended_channel=final_channel,
        recipient=recipient,
        message_subject=llm_out.message_subject,
        message_body=llm_out.message_body,
        playbook_id_used=llm_out.playbook_id_used,
        playbook_success_rate_at_decision=llm_out.playbook_success_rate_at_decision,
        agent_reasoning=agent_reasoning,
        confidence=confidence,
        requires_approval=requires_approval,
        approval_reasoning=approval_reasoning,
        status=status,
        auto_approved=auto_approved,
    )

    intervention_id = _persist_intervention(output)
    output.intervention_id = intervention_id
    return output
