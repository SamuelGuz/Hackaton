"""Make.com webhook dispatcher per CONTRACTS.md section 3.

Sólo expone los webhooks que efectivamente llama el `channel_router`
(email, slack, whatsapp). El resto se eliminó como código muerto.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_SECS = 10.0


def slack_approval_notice_markdown(
    *,
    account_name: str,
    account_arr: float,
    account_industry: str,
    account_plan: str,
    channel: str,
    confidence: float,
    trigger_reason: str,
    approval_reasoning: str,
) -> str:
    """Markdown for Slack approval card (mensaje antes de los bloques de botones)."""
    arr_disp = f"${account_arr:,.0f}"
    return (
        f"⚠️  *Aprobación requerida — {account_name}*\n"
        f"  • *ARR:* {arr_disp} | *Industria:* {account_industry} | *Plan:* {account_plan}\n"
        f"  • *Canal:* {channel} | *Confianza:* {confidence:.2f}\n"
        f"  • *Motivo:* {trigger_reason}\n"
        f"  • *Aprobación:* {approval_reasoning}"
    )


def _post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    intervention_id = payload.get("intervention_id")
    host = url.split("/")[2] if url.startswith("http") else url[:40]
    logger.info("make_webhook POST %s intervention=%s", host, intervention_id)
    try:
        resp = httpx.post(url, json=payload, timeout=_TIMEOUT_SECS)
    except httpx.HTTPError as exc:
        logger.warning(
            "make_webhook %s network error for intervention=%s: %s",
            host,
            intervention_id,
            exc,
        )
        raise
    if resp.status_code >= 400:
        logger.warning(
            "make_webhook %s -> %s for intervention=%s body=%s",
            host,
            resp.status_code,
            intervention_id,
            resp.text[:300],
        )
    else:
        logger.info(
            "make_webhook %s -> %s for intervention=%s",
            host,
            resp.status_code,
            intervention_id,
        )
    resp.raise_for_status()
    try:
        return resp.json()
    except Exception:
        return {}


def send_email(
    intervention_id: str,
    to: str,
    to_name: str,
    subject: str,
    body: str,
    account_id: str,
    account_name: str,
) -> dict[str, Any]:
    return _post(
        os.environ["MAKE_WEBHOOK_EMAIL"],
        {
            "intervention_id": intervention_id,
            "to": to,
            "to_name": to_name,
            "subject": subject,
            "body": body,
            "account_id": account_id,
            "account_name": account_name,
        },
    )


def send_slack(
    intervention_id: str,
    account_id: str,
    account_name: str,
    status: str,
    auto_approved: bool,
    channel: str,
    recipient: str,
    trigger_reason: str,
    confidence: float,
    playbook_id: str,
    playbook_success_rate: float | None,
    approval_reasoning: str,
    agent_reasoning: str,
    account_arr: float,
    account_industry: str,
    account_plan: str,
) -> dict[str, Any]:
    notice = slack_approval_notice_markdown(
        account_name=account_name,
        account_arr=account_arr,
        account_industry=account_industry,
        account_plan=account_plan,
        channel=channel,
        confidence=confidence,
        trigger_reason=trigger_reason,
        approval_reasoning=approval_reasoning,
    )
    return _post(
        os.environ["MAKE_WEBHOOK_SLACK"],
        {
            "intervention_id": intervention_id,
            "account_id": account_id,
            "account_name": account_name,
            "status": status,
            "auto_approved": auto_approved,
            "channel": channel,
            "recipient": recipient,
            "trigger_reason": trigger_reason,
            "confidence": confidence,
            "playbook_id": playbook_id,
            "playbook_success_rate": playbook_success_rate,
            "approval_reasoning": approval_reasoning,
            "agent_reasoning": agent_reasoning,
            "account_arr": account_arr,
            "account_industry": account_industry,
            "account_plan": account_plan,
            "slack_message_markdown": notice,
        },
    )


def send_whatsapp(
    intervention_id: str,
    to_phone: str,
    to_name: str,
    message: str,
    account_id: str,
    account_name: str,
) -> dict[str, Any]:
    return _post(
        os.environ["MAKE_WEBHOOK_WHATSAPP"],
        {
            "intervention_id": intervention_id,
            "to_phone": to_phone,
            "to_name": to_name,
            "message": message,
            "account_id": account_id,
            "account_name": account_name,
        },
    )
