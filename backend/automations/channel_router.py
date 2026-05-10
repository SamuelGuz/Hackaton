"""Channel router — picks email/slack/whatsapp/voice."""
import os
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

from .elevenlabs_client import generate_audio
from . import make_webhooks

router = APIRouter(prefix="/dispatch-intervention", tags=["dispatch"])

_AUDIO_BUCKET = "audio"


def _sb() -> Client:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def _callback_url() -> str:
    base = os.environ.get("API_BASE_URL", "").rstrip("/")
    return f"{base}/api/v1/dispatch-intervention/callback"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- request / response models ----------

class VoiceConfig(BaseModel):
    voice_id: Optional[str] = None
    speed: float = 1.0


class DispatchRequest(BaseModel):
    intervention_id: str
    channel: str
    recipient: str
    message_body: str
    message_subject: Optional[str] = None
    voice_config: Optional[VoiceConfig] = None
    # Campos de cuenta (email + slack)
    to_name: Optional[str] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    account_arr: Optional[float] = None
    account_industry: Optional[str] = None
    account_plan: Optional[str] = None
    # Campos de agente (slack approval)
    trigger_reason: Optional[str] = None
    confidence: Optional[float] = None
    playbook_id: Optional[str] = None
    playbook_success_rate: Optional[float] = None
    approval_reasoning: Optional[str] = None
    agent_reasoning: Optional[str] = None
    auto_approved: Optional[bool] = None
    approval_status: Optional[str] = None
    # WhatsApp template fields
    nombre_cliente: Optional[str] = None
    nombre_empresa: Optional[str] = None
    motivo_alerta: Optional[str] = None


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

def _upload_audio(audio_bytes: bytes, intervention_id: str) -> str:
    path = f"interventions/{intervention_id}.mp3"
    sb = _sb()
    sb.storage.from_(_AUDIO_BUCKET).upload(
        path, audio_bytes, {"content-type": "audio/mpeg"}
    )
    return sb.storage.from_(_AUDIO_BUCKET).get_public_url(path)


def _update_intervention(intervention_id: str, data: dict) -> None:
    _sb().table("interventions").update(data).eq("id", intervention_id).execute()


# ---------- endpoints ----------

@router.post("", status_code=202)
def dispatch_intervention(body: DispatchRequest):
    audio_url: str | None = None
    fallback_used = False

    try:
        callback = _callback_url()
        if body.channel == "email":
            make_webhooks.send_email(
                intervention_id=body.intervention_id,
                to=body.recipient,
                to_name=body.to_name or "",
                subject=body.message_subject or "Un mensaje de tu CSM",
                body=body.message_body,
                account_id=body.account_id or "",
                account_name=body.account_name or "",
            )

        elif body.channel == "slack":
            make_webhooks.send_slack(
                intervention_id=body.intervention_id,
                account_id=body.account_id or "",
                account_name=body.account_name or "",
                status=body.approval_status or "pending",
                auto_approved=body.auto_approved if body.auto_approved is not None else True,
                channel=body.channel,
                recipient=body.recipient,
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

        elif body.channel == "whatsapp":
            make_webhooks.send_whatsapp(
                intervention_id=body.intervention_id,
                to_phone=body.recipient,
                to_name=body.to_name or "",
                message=body.message_body,
                account_id=body.account_id or "",
                account_name=body.account_name or "",
            )

        elif body.channel == "voice_call":
            voice_id = body.voice_config.voice_id if body.voice_config else None
            try:
                audio_bytes = generate_audio(body.message_body, voice_id)
                audio_url = _upload_audio(audio_bytes, body.intervention_id)
            except Exception:
                # ElevenLabs or storage failed — use pre-recorded fallback
                audio_url = os.environ.get("FALLBACK_AUDIO_URL", "")
                fallback_used = True

            make_webhooks.send_voice(
                intervention_id=body.intervention_id,
                to_phone=body.recipient,
                audio_url=audio_url,
                fallback_text=body.message_body,
                callback_url=callback,
            )

        else:
            raise HTTPException(
                status_code=400,
                detail={"error": "invalid_payload", "message": f"Unknown channel: {body.channel}"},
            )

    except HTTPException:
        raise
    except Exception as exc:
        _update_intervention(body.intervention_id, {"status": "failed"})
        raise HTTPException(
            status_code=500,
            detail={"error": "dispatch_failed", "message": str(exc)},
        )

    update: dict = {"status": "sent", "sent_at": _now()}
    if audio_url:
        update["voice_audio_url"] = audio_url

    _update_intervention(body.intervention_id, update)

    response: dict = {
        "intervention_id": body.intervention_id,
        "status": "dispatched",
        "channel": body.channel,
        "estimated_delivery_seconds": 15,
    }
    if fallback_used:
        response["fallback_used"] = True
        response["fallback_audio_url"] = audio_url

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
    elif body.status == "failed":
        update["status"] = "failed"

    try:
        _update_intervention(body.intervention_id, update)
    except Exception:
        pass  # best-effort; returning 500 causes Make to retry indefinitely
    return {"received": True}


@router.post("/conversation")
def receive_conversation(body: ConversationPayload):
    """
    Make llama este endpoint cuando el cliente responde un mensaje.
    Guarda la respuesta en conversations y marca la intervención como respondida.
    """
    sb = _sb()
    now = body.received_at or _now()

    # Buscar account_id si no vino en el payload (por intervention_id)
    account_id = body.account_id
    if not account_id and body.intervention_id:
        row = (
            sb.table("interventions")
            .select("account_id")
            .eq("id", body.intervention_id)
            .maybe_single()
            .execute()
        )
        if row.data:
            account_id = row.data["account_id"]

    if not account_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_payload", "message": "Se requiere account_id o intervention_id válido"},
        )

    # Guardar conversación
    sb.table("conversations").insert({
        "account_id": account_id,
        "channel": body.channel,
        "direction": "inbound",
        "participants": [body.sender],
        "content": body.content,
        "occurred_at": now,
    }).execute()

    # Actualizar intervención a "responded"
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
