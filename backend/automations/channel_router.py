"""Multi-channel dispatch router (`/dispatch-intervention/*`).

Sólo expone el flujo multi-canal (`POST /multi`) + endpoints de soporte
(callback de Make, status, conversación inbound, aprobación). El endpoint
single-channel se quitó: el frontend siempre va por `/multi`.
"""
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import Client, create_client

from . import make_webhooks
from .elevenlabs_client import get_convai_signed_url

router = APIRouter(prefix="/dispatch-intervention", tags=["dispatch"])


def _sb() -> Client:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- request / response models ----------

class VoiceConfig(BaseModel):
    voice_id: Optional[str] = None
    speed: float = 1.0


class ChannelDispatch(BaseModel):
    """Una entrada de canal dentro de un dispatch multi-canal."""
    channel: str  # email | slack | whatsapp | voice_call
    recipient: str
    message_subject: Optional[str] = None


class MultiDispatchRequest(BaseModel):
    """Despacha la misma intervención por uno o varios canales en una sola request.

    El status se valida UNA sola vez. Cada canal se intenta independientemente; el
    response devuelve resultado por canal. Status final de la intervención: 'sent'
    si al menos uno OK, 'failed' si todos fallaron.
    """
    intervention_id: str
    message_body: str
    channels: list[ChannelDispatch]
    voice_config: Optional[VoiceConfig] = None
    to_name: Optional[str] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    account_arr: Optional[float] = None
    account_industry: Optional[str] = None
    account_plan: Optional[str] = None
    trigger_reason: Optional[str] = None
    confidence: Optional[float] = None
    playbook_id: Optional[str] = None
    playbook_success_rate: Optional[float] = None
    approval_reasoning: Optional[str] = None
    agent_reasoning: Optional[str] = None
    auto_approved: Optional[bool] = None
    approval_status: Optional[str] = None


class ConversationPayload(BaseModel):
    intervention_id: Optional[str] = None
    account_id: Optional[str] = None
    channel: str
    content: str
    sender: str
    received_at: Optional[str] = None


class CallbackPayload(BaseModel):
    intervention_id: str
    channel: str
    status: str
    external_id: Optional[str] = None
    delivered_at: Optional[str] = None
    error_message: Optional[str] = None


# ---------- helpers ----------

def _update_intervention(intervention_id: str, data: dict) -> None:
    _sb().table("interventions").update(data).eq("id", intervention_id).execute()


# ---------- endpoints ----------

@router.post("/multi", status_code=202)
def dispatch_intervention_multi(body: MultiDispatchRequest):
    """Despacha una intervención por múltiples canales en una sola request.

    Validación de status una sola vez. Cada canal corre independientemente.
    Para `voice_call` no usamos Make/Twilio: pedimos un `signed_url` a ElevenLabs
    ConvAI (una sola vez aunque se pida varias veces) y devolvemos `session_mode`
    + `signed_url` en el top-level del response.
    """
    if not body.channels:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_payload", "message": "channels[] no puede estar vacío"},
        )

    sb = _sb()
    inv_row = (
        sb.table("interventions")
        .select("id,status")
        .eq("id", body.intervention_id)
        .limit(1)
        .execute()
    )
    rows = getattr(inv_row, "data", None) or []
    if not rows:
        raise HTTPException(
            status_code=404,
            detail={"error": "intervention_not_found", "message": f"intervention {body.intervention_id} not found"},
        )
    current_status = str(rows[0].get("status") or "")
    if current_status not in ("pending", "approved", "pending_approval"):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "intervention_not_approved",
                "message": f"intervention status is '{current_status}', must be 'pending', 'approved' or 'pending_approval' to dispatch",
            },
        )

    # ConvAI: un único signed_url aunque vengan varios canales.
    signed_url: str | None = None
    convai_error = ""
    if any(c.channel == "voice_call" for c in body.channels):
        try:
            signed_url = get_convai_signed_url(os.environ.get("ELEVENLABS_AGENT_ID"))
        except Exception as exc:  # noqa: BLE001
            convai_error = str(exc)

    results: list[dict] = []
    any_ok = False
    for ch in body.channels:
        try:
            if ch.channel == "email":
                make_webhooks.send_email(
                    intervention_id=body.intervention_id,
                    to=ch.recipient,
                    to_name=body.to_name or "",
                    subject=ch.message_subject or "Un mensaje de tu CSM",
                    body=body.message_body,
                    account_id=body.account_id or "",
                    account_name=body.account_name or "",
                )
            elif ch.channel == "slack":
                make_webhooks.send_slack(
                    intervention_id=body.intervention_id,
                    account_id=body.account_id or "",
                    account_name=body.account_name or "",
                    status=body.approval_status or "pending",
                    auto_approved=body.auto_approved if body.auto_approved is not None else True,
                    channel=ch.channel,
                    recipient=ch.recipient,
                    trigger_reason=body.trigger_reason or "",
                    confidence=body.confidence or 0.0,
                    playbook_id=body.playbook_id or "",
                    playbook_success_rate=body.playbook_success_rate,
                    approval_reasoning=body.approval_reasoning or "",
                    agent_reasoning=body.agent_reasoning or body.message_body,
                    account_arr=body.account_arr or 0,
                    account_industry=body.account_industry or "",
                    account_plan=body.account_plan or "",
                )
            elif ch.channel == "whatsapp":
                make_webhooks.send_whatsapp(
                    intervention_id=body.intervention_id,
                    to_phone=ch.recipient,
                    to_name=body.to_name or "",
                    message=body.message_body,
                    account_id=body.account_id or "",
                    account_name=body.account_name or "",
                )
            elif ch.channel == "voice_call":
                if not signed_url:
                    results.append({
                        "channel": "voice_call",
                        "status": "failed",
                        "error": convai_error or "convai_signed_url_missing",
                    })
                    continue
                results.append({
                    "channel": "voice_call",
                    "status": "delivered",
                    "signed_url": signed_url,
                })
                any_ok = True
                continue
            else:
                results.append({
                    "channel": ch.channel,
                    "status": "failed",
                    "error": f"unknown_channel:{ch.channel}",
                })
                continue

            results.append({"channel": ch.channel, "status": "delivered"})
            any_ok = True
        except Exception as exc:  # noqa: BLE001
            results.append({
                "channel": ch.channel,
                "status": "failed",
                "error": str(exc),
            })

    update: dict = {"status": "sent" if any_ok else "failed", "sent_at": _now()}
    _update_intervention(body.intervention_id, update)

    response: dict = {
        "intervention_id": body.intervention_id,
        "results": results,
        "estimated_delivery_seconds": 15,
    }
    if signed_url:
        response["session_mode"] = "convai"
        response["signed_url"] = signed_url
    return response


@router.get("/status/{intervention_id}")
def get_dispatch_status(intervention_id: str):
    row = (
        _sb()
        .table("interventions")
        .select("id, status, channel, sent_at, delivered_at")
        .eq("id", intervention_id)
        .maybe_single()
        .execute()
    )
    if not row.data:
        raise HTTPException(
            status_code=404,
            detail={"error": "account_not_found", "message": "Intervention not found"},
        )
    data = row.data
    return {
        "intervention_id": intervention_id,
        "status": data["status"],
        "channel_status": {data["channel"]: data["status"]},
        "timestamps": {
            "sent_at": data.get("sent_at"),
            "delivered_at": data.get("delivered_at"),
        },
    }


@router.post("/callback")
def dispatch_callback(body: CallbackPayload):
    update: dict = {"status": body.status}
    if body.status == "delivered":
        update["delivered_at"] = body.delivered_at or _now()

    try:
        _update_intervention(body.intervention_id, update)
    except Exception:
        # best-effort; devolver 500 hace que Make reintente indefinidamente
        pass
    return {"received": True}


@router.post("/conversation")
def receive_conversation(body: ConversationPayload):
    """
    Make llama este endpoint cuando el cliente responde un mensaje.
    Guarda la respuesta en conversations y marca la intervención como respondida.
    """
    sb = _sb()
    now = body.received_at or _now()

    account_id = body.account_id
    if not account_id and body.intervention_id:
        try:
            row = (
                sb.table("interventions")
                .select("account_id")
                .eq("id", body.intervention_id)
                .maybe_single()
                .execute()
            )
            if row.data:
                account_id = row.data["account_id"]
        except Exception:
            pass

    if not account_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_payload", "message": "Se requiere account_id o intervention_id válido"},
        )

    sb.table("conversations").insert({
        "account_id": account_id,
        "channel": body.channel,
        "direction": "inbound",
        "participants": [body.sender],
        "content": body.content,
        "occurred_at": now,
    }).execute()

    if body.intervention_id:
        _update_intervention(body.intervention_id, {
            "status": "responded",
            "responded_at": now,
        })

    return {"received": True, "account_id": account_id}


@router.get("/approve")
def approve_intervention(intervention_id: str, action: str):
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail={"error": "invalid_action", "message": "action must be approve or reject"})

    status = "approved" if action == "approve" else "rejected"
    _update_intervention(intervention_id, {"status": status})
    return {"intervention_id": intervention_id, "status": status}
