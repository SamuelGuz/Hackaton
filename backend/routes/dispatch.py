"""Dispatch endpoint — fires Make webhooks per CONTRACTS.md §3."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.automations.make_webhooks import post_email_webhook, post_whatsapp_webhook
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dispatch"])

InterventionChannel = Literal["email", "slack", "whatsapp", "voice_call"]
DeliveryStatus = Literal["pending", "sent", "delivered", "failed"]


class DispatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    intervention_id: str = Field(..., min_length=1)


class DispatchResponse(BaseModel):
    intervention_id: str
    channel: InterventionChannel
    status: DeliveryStatus
    error: str | None = None


def _load_intervention(intervention_id: str) -> dict[str, Any] | None:
    sb = get_supabase()
    res = (
        sb.table("interventions")
        .select("*")
        .eq("id", intervention_id)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _load_account(account_id: str) -> dict[str, Any] | None:
    sb = get_supabase()
    res = (
        sb.table("accounts")
        .select("id,name,champion_name,champion_phone")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _mark_status(intervention_id: str, status: DeliveryStatus, error: str | None) -> None:
    sb = get_supabase()
    payload: dict[str, Any] = {"status": status}
    if status == "sent":
        payload["sent_at"] = datetime.now(timezone.utc).isoformat()
    sb.table("interventions").update(payload).eq("id", intervention_id).execute()


@router.post("/dispatch-intervention", response_model=DispatchResponse)
def post_dispatch_intervention(payload: DispatchRequest) -> DispatchResponse:
    """Dispatch an intervention via Make webhook. Currently supports email channel."""
    intervention = _load_intervention(payload.intervention_id)
    if not intervention:
        raise HTTPException(status_code=404, detail="intervention_not_found")

    status = intervention.get("status")
    if status not in ("pending", "approved", "pending_approval"):
        raise HTTPException(
            status_code=409,
            detail=f"intervention status is {status!r}; must be 'pending', 'approved' or 'pending_approval' to dispatch",
        )

    channel = intervention.get("channel")
    if channel not in ("email", "whatsapp"):
        raise HTTPException(
            status_code=501,
            detail=f"channel {channel!r} dispatch not implemented yet",
        )

    account = _load_account(intervention["account_id"]) or {}

    if channel == "email":
        body_payload = {
            "intervention_id": intervention["id"],
            "to": intervention.get("recipient"),
            "to_name": account.get("champion_name"),
            "subject": intervention.get("message_subject") or "",
            "body": intervention.get("message_body") or "",
            "account_id": intervention.get("account_id"),
            "account_name": account.get("name"),
        }
        ok, err = post_email_webhook(body_payload)
    else:  # whatsapp
        body_payload = {
            "intervention_id": intervention["id"],
            "to_phone": intervention.get("recipient") or account.get("champion_phone"),
            "to_name": account.get("champion_name"),
            "message": intervention.get("message_body") or "",
            "account_id": intervention.get("account_id"),
            "account_name": account.get("name"),
        }
        ok, err = post_whatsapp_webhook(body_payload)

    if not ok:
        _mark_status(payload.intervention_id, "failed", err)
        return DispatchResponse(
            intervention_id=payload.intervention_id,
            channel=channel,
            status="failed",
            error=err,
        )

    _mark_status(payload.intervention_id, "sent", None)
    return DispatchResponse(
        intervention_id=payload.intervention_id,
        channel=channel,
        status="sent",
    )
