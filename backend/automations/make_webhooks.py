"""Make.com webhook dispatcher per CONTRACTS.md §3."""

from __future__ import annotations

import logging
import os
from typing import Any
import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_SECS = 10.0


def _post(url: str, payload: dict[str, Any], label: str) -> tuple[bool, str | None]:
    try:
        resp = httpx.post(url, json=payload, timeout=_TIMEOUT_SECS)
        if resp.status_code >= 400:
            return False, f"webhook {resp.status_code}: {resp.text[:300]}"
        return True, None
    except Exception as exc:  # noqa: BLE001
        logger.exception("%s webhook post failed", label)
        return False, str(exc)


def _legacy_post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    resp = httpx.post(url, json=payload, timeout=_TIMEOUT_SECS)
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
    return _legacy_post(
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
    return _legacy_post(
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
        },
    )


def send_whatsapp(
    intervention_id: str,
    to_phone: str,
    nombre_cliente: str,
    nombre_empresa: str,
    motivo_alerta: str,
    callback_url: str,
) -> dict[str, Any]:
    return _legacy_post(
        os.environ["MAKE_WEBHOOK_WHATSAPP"],
        {
            "intervention_id": intervention_id,
            "to_phone": to_phone,
            "nombre_cliente": nombre_cliente,
            "nombre_empresa": nombre_empresa,
            "motivo_alerta": motivo_alerta,
            "callback_url": callback_url,
        },
    )


def send_voice(
    intervention_id: str,
    to_phone: str,
    audio_url: str,
    fallback_text: str,
    callback_url: str,
) -> dict[str, Any]:
    return _legacy_post(
        os.environ["MAKE_WEBHOOK_VOICE"],
        {
            "intervention_id": intervention_id,
            "to_phone": to_phone,
            "audio_url": audio_url,
            "fallback_text": fallback_text,
            "callback_url": callback_url,
        },
    )


def _email_webhook_url() -> str | None:
    return os.environ.get("MAKE_EMAIL_WEBHOOK_URL") or os.environ.get("MAKE_WEBHOOK_URL")


def _whatsapp_webhook_url() -> str | None:
    return os.environ.get("MAKE_WHATSAPP_WEBHOOK_URL")


def post_email_webhook(payload: dict[str, Any]) -> tuple[bool, str | None]:
    url = _email_webhook_url()
    if not url:
        return False, "no_webhook_url_configured"
    return _post(url, payload, "email")


def post_whatsapp_webhook(payload: dict[str, Any]) -> tuple[bool, str | None]:
    url = _whatsapp_webhook_url()
    if not url:
        return False, "no_webhook_url_configured"
    return _post(url, payload, "whatsapp")
