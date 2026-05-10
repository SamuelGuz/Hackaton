"""CSM Slack notifier — fire-and-forget intervention status posts.

Reusa el mismo Make webhook configurado para el canal Slack
(`MAKE_WEBHOOK_SLACK`) y el mismo formato de payload que `send_slack` para que
la escena de Make no tenga que distinguir entre orígenes.

Notifica SIEMPRE que se crea una intervención — el copy del `slack_message_markdown`
varía según el caso (aprobación requerida vs auto-aprobada vs envío directo)
para que el CSM tenga visibilidad de todo lo que sale.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from backend.agents.intervention_engine import InterventionOutput

logger = logging.getLogger(__name__)

_TIMEOUT_SECS = 5.0


def _webhook_url() -> str | None:
    return os.environ.get("MAKE_WEBHOOK_SLACK")


def _load_account(account_id: str) -> dict | None:
    """Load the account row from Supabase. Returns None if not found or on error."""
    from backend.shared.supabase_client import get_supabase

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


def _slack_markdown(
    intervention: InterventionOutput,
    *,
    account_name: str,
    account_arr: float,
    account_industry: str,
    account_plan: str,
) -> str:
    """Construye el bloque markdown que renderiza Make en Slack.

    El header cambia según si la intervención requiere aprobación humana,
    fue auto-aprobada por confianza/ARR, o no necesitaba aprobación. El resto
    de la card es idéntico para que la escena de Make sea estable.
    """
    arr_disp = f"${account_arr:,.0f}"
    confidence = float(intervention.confidence or 0)
    channel = intervention.recommended_channel or "—"
    trigger_reason = intervention.trigger_reason or "—"
    approval_reasoning = intervention.approval_reasoning or "—"

    if intervention.requires_approval and not intervention.auto_approved:
        header = f"⚠️  *Aprobación requerida — {account_name}*"
        approval_line = f"  • *Aprobación:* {approval_reasoning}"
    elif intervention.auto_approved:
        header = f"✅ *Auto-aprobada — {account_name}*"
        approval_line = f"  • *Auto-aprobada:* {approval_reasoning}"
    else:
        header = f"🚀 *Intervención lanzada — {account_name}*"
        approval_line = "  • *Aprobación:* no requerida"

    return (
        f"{header}\n"
        f"  • *ARR:* {arr_disp} | *Industria:* {account_industry} | *Plan:* {account_plan}\n"
        f"  • *Canal:* {channel} | *Confianza:* {confidence:.2f}\n"
        f"  • *Motivo:* {trigger_reason}\n"
        f"{approval_line}"
    )


def _build_payload(intervention: InterventionOutput, account: dict) -> dict[str, Any]:
    data: dict[str, Any] = intervention.model_dump()
    account_name = account.get("name") or "—"
    account_arr = float(account.get("arr_usd") or 0)
    account_industry = account.get("industry") or "—"
    account_plan = account.get("plan") or "—"

    notice = _slack_markdown(
        intervention,
        account_name=account_name,
        account_arr=account_arr,
        account_industry=account_industry,
        account_plan=account_plan,
    )

    return {
        "intervention_id": data.get("intervention_id"),
        "account_id": data.get("account_id"),
        "account_name": account_name,
        "status": data.get("status"),
        "auto_approved": bool(data.get("auto_approved")),
        "channel": data.get("recommended_channel"),
        "recipient": data.get("recipient"),
        "trigger_reason": data.get("trigger_reason"),
        "confidence": float(data.get("confidence") or 0),
        "playbook_id": data.get("playbook_id_used"),
        "playbook_success_rate": data.get("playbook_success_rate_at_decision"),
        "approval_reasoning": data.get("approval_reasoning") or "—",
        "agent_reasoning": data.get("agent_reasoning"),
        "account_arr": account_arr,
        "account_industry": account_industry,
        "account_plan": account_plan,
        "slack_message_markdown": notice,
    }


def notify_csm(intervention: InterventionOutput, account: dict) -> None:
    """Post a status update to Slack about an intervention. Never raises — logs on error."""
    try:
        url = _webhook_url()
        if not url:
            logger.warning("slack_notifier: MAKE_WEBHOOK_SLACK no configurado; skip")
            return

        payload = _build_payload(intervention, account or {})
        logger.info(
            "slack_notifier: posting intervention %s (status=%s, auto_approved=%s)",
            payload.get("intervention_id"),
            payload.get("status"),
            payload.get("auto_approved"),
        )
        resp = httpx.post(url, json=payload, timeout=_TIMEOUT_SECS)
        if resp.status_code >= 400:
            logger.warning(
                "slack_notifier: webhook returned %s: %s",
                resp.status_code,
                resp.text[:300],
            )
        else:
            logger.info("slack_notifier: webhook OK (%s)", resp.status_code)
    except Exception:
        logger.exception("slack_notifier: failed to post intervention notification")
        return
