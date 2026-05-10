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
