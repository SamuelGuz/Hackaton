"""CSM Slack notifier — fire-and-forget intervention status posts."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from backend.agents.intervention_engine import InterventionOutput
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_TIMEOUT_SECS = 5.0


def _webhook_url() -> str | None:
    return os.environ.get("MAKE_SLACK_WEBHOOK_URL") or os.environ.get("MAKE_WEBHOOK_URL")


def _load_account(account_id: str) -> dict | None:
    """Load the account row from Supabase. Returns None if not found or on error."""
    try:
        sb = get_supabase()
        res = (
            sb.table("accounts")
            .select("id,name,industry,plan,arr_usd")
            .eq("id", account_id)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        return rows[0] if rows else None
    except Exception:
        logger.exception("slack_notifier: failed to load account %s", account_id)
        return None


def _build_payload(intervention: InterventionOutput, account: dict) -> dict[str, Any]:
    data: dict[str, Any] = intervention.model_dump()
    return {
        "intervention_id": data.get("intervention_id"),
        "account_id": data.get("account_id"),
        "account_name": account.get("name"),
        "status": data.get("status"),
        "auto_approved": bool(data.get("auto_approved")),
        "channel": data.get("recommended_channel"),
        "recipient": data.get("recipient"),
        "trigger_reason": data.get("trigger_reason"),
        "confidence": data.get("confidence"),
        "playbook_id": data.get("playbook_id_used"),
        "playbook_success_rate": data.get("playbook_success_rate_at_decision"),
        "approval_reasoning": data.get("approval_reasoning"),
        "agent_reasoning": data.get("agent_reasoning"),
        "account_arr": account.get("arr_usd"),
        "account_industry": account.get("industry"),
        "account_plan": account.get("plan"),
    }


def notify_csm(intervention: InterventionOutput, account: dict) -> None:
    """Post a status update to Slack about an intervention. Never raises — logs on error."""
    try:
        url = _webhook_url()
        if not url:
            logger.warning("slack_notifier: no MAKE_SLACK_WEBHOOK_URL or MAKE_WEBHOOK_URL set; skipping")
            return

        payload = _build_payload(intervention, account or {})
        resp = httpx.post(url, json=payload, timeout=_TIMEOUT_SECS)
        if resp.status_code >= 400:
            logger.warning(
                "slack_notifier: webhook returned %s: %s",
                resp.status_code,
                resp.text[:300],
            )
    except Exception:
        logger.exception("slack_notifier: failed to post intervention notification")
        return
