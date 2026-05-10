"""Channel router — picks email/slack/whatsapp/voice."""
import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

from .elevenlabs_client import get_convai_signed_url
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
    # Campos opcionales (mismos significados que DispatchRequest)
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

def _upload_audio(audio_bytes: bytes, intervention_id: str) -> str:
    path = f"interventions/{intervention_id}.mp3"
    sb = _sb()
    sb.storage.from_(_AUDIO_BUCKET).upload(
        path, audio_bytes, {"content-type": "audio/mpeg"}
    )
    return sb.storage.from_(_AUDIO_BUCKET).get_public_url(path)


def _update_intervention(intervention_id: str, data: dict) -> None:
    _sb().table("interventions").update(data).eq("id", intervention_id).execute()


def _classify_outcome_llm(content: str) -> tuple[str, str]:
    """Usa el LLM barato para clasificar la respuesta del cliente como success o negative."""
    try:
        from backend.shared.llm_client import get_llm_client, haiku_model
        llm = get_llm_client()
        result = llm.complete(
            f"""Classify this customer reply to a business email.
Reply with ONLY one word: success or negative
- negative: customer is not interested, wants to cancel, unsubscribe, or explicitly rejects
- success: customer engages, asks questions, or any other response

Customer reply:
{content[:800]}""",
            model=haiku_model(),
            max_tokens=10,
            temperature=0.0,
        )
        outcome = "negative" if "negative" in result.lower() else "success"
        return outcome, f"Clasificado por IA: {result.strip()}"
    except Exception as exc:
        logger.warning("LLM outcome classification failed, defaulting to success: %s", exc)
        return "success", "Respuesta recibida (clasificación IA no disponible)"


def _apply_playbook_outcome(sb: Client, playbook_id: str, outcome: str) -> None:
    """Actualiza los contadores de éxito en playbook_memory (mismo cálculo que record_outcome)."""
    try:
        pb_res = (
            sb.table("playbook_memory")
            .select("id, times_used, times_succeeded, success_rate")
            .eq("id", playbook_id)
            .limit(1)
            .execute()
        )
        pb_rows = pb_res.data or []
        if not pb_rows:
            return
        pb = pb_rows[0]
        new_times_used = int(pb.get("times_used") or 0) + 1
        new_times_succeeded = int(pb.get("times_succeeded") or 0)
        if outcome in ("success", "partial"):
            new_times_succeeded += 1
        new_rate = round(new_times_succeeded / new_times_used, 4) if new_times_used else 0.0
        sb.table("playbook_memory").update({
            "times_used": new_times_used,
            "times_succeeded": new_times_succeeded,
            "success_rate": new_rate,
        }).eq("id", playbook_id).execute()
    except Exception as exc:
        logger.warning("Failed to update playbook_memory for %s: %s", playbook_id, exc)


# ---------- endpoints ----------

@router.post("", status_code=202)
def dispatch_intervention(body: DispatchRequest):
    audio_url: str | None = None
    signed_url: str | None = None
    fallback_used = False

    # Validar que la intervención existe y está aprobada antes de despachar.
    # CONTRACTS.md §2.4: dispatch debe rechazar si status NO está en ('pending', 'approved').
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
            agent_id = os.environ.get("ELEVENLABS_AGENT_ID")
            signed_url = get_convai_signed_url(agent_id)

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
    if signed_url:
        response["session_mode"] = "convai"
        response["signed_url"] = signed_url

    return response


@router.post("/multi", status_code=202)
def dispatch_intervention_multi(body: MultiDispatchRequest):
    """Despacha una intervención por múltiples canales en una sola request.

    Validación de status una sola vez. Cada canal corre independientemente.
    Para `voice_call` no usamos Make/Twilio: pedimos un `signed_url` a ElevenLabs
    ConvAI (una sola vez aunque se pida varias veces) y devolvemos `session_mode`
    + `signed_url` en el top-level del response (igual que el endpoint legacy).
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
    if any(c.channel == "voice_call" for c in body.channels):
        try:
            signed_url = get_convai_signed_url(os.environ.get("ELEVENLABS_AGENT_ID"))
        except Exception as exc:  # noqa: BLE001
            # Si ConvAI falla, marcamos cada voice_call como failed pero seguimos con los otros.
            signed_url = None
            _convai_error = str(exc)
        else:
            _convai_error = ""
    else:
        _convai_error = ""

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
                        "error": _convai_error or "convai_signed_url_missing",
                    })
                    continue
                # No llamamos Make: el frontend abre un panel WS con el signed_url.
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
    Guarda la respuesta en conversations, marca la intervención como respondida
    y graba el outcome (success/negative) inferido por LLM.

    Resolución de account_id / intervention_id en tres pasos:
      1. account_id viene directo en el payload.
      2. intervention_id viene en el payload → SELECT desde interventions.
      3. Fallback: buscar account por champion_email = sender → intervención más
         reciente en estado sent/delivered.
    """
    sb = _sb()
    now = body.received_at or _now()

    account_id = body.account_id
    intervention_id = body.intervention_id
    existing_outcome: str | None = None
    playbook_id: str | None = None

    # Paso 2: si tenemos intervention_id, traer account_id + datos de outcome en una sola query
    if intervention_id:
        try:
            row = (
                sb.table("interventions")
                .select("account_id, outcome, playbook_id_used")
                .eq("id", intervention_id)
                .maybe_single()
                .execute()
            )
            if row.data:
                if not account_id:
                    account_id = row.data.get("account_id")
                existing_outcome = row.data.get("outcome")
                playbook_id = row.data.get("playbook_id_used")
        except Exception:
            pass

    # Paso 3: fallback por sender (champion_email) cuando aún no tenemos account_id
    if not account_id and body.sender:
        try:
            acc_row = (
                sb.table("accounts")
                .select("id")
                .eq("champion_email", body.sender)
                .maybe_single()
                .execute()
            )
            if acc_row.data:
                account_id = acc_row.data["id"]
                if not intervention_id:
                    inv_row = (
                        sb.table("interventions")
                        .select("id, outcome, playbook_id_used")
                        .eq("account_id", account_id)
                        .in_("status", ["sent", "delivered"])
                        .order("created_at", desc=True)
                        .limit(1)
                        .execute()
                    )
                    if inv_row.data:
                        intervention_id = inv_row.data[0]["id"]
                        existing_outcome = inv_row.data[0].get("outcome")
                        playbook_id = inv_row.data[0].get("playbook_id_used")
        except Exception:
            pass

    if not account_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_payload", "message": "Se requiere account_id o intervention_id válido"},
        )

    # Guardar conversación inbound
    sb.table("conversations").insert({
        "account_id": account_id,
        "channel": body.channel,
        "direction": "inbound",
        "participants": [body.sender],
        "content": body.content,
        "occurred_at": now,
    }).execute()

    # Actualizar intervención: status responded + outcome inferido por LLM
    if intervention_id:
        update: dict = {"status": "responded", "responded_at": now}
        inferred_outcome: str | None = None
        if not existing_outcome:
            inferred_outcome, notes = _classify_outcome_llm(body.content)
            update["outcome"] = inferred_outcome
            update["outcome_notes"] = notes
            update["outcome_recorded_at"] = now
        _update_intervention(intervention_id, update)

        if inferred_outcome and playbook_id:
            _apply_playbook_outcome(sb, playbook_id, inferred_outcome)

    return {"received": True, "account_id": account_id}


@router.get("/approve")
def approve_intervention(intervention_id: str, action: str):
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail={"error": "invalid_action", "message": "action must be approve or reject"})

    status = "approved" if action == "approve" else "rejected"
    _update_intervention(intervention_id, {"status": status})
    return {"intervention_id": intervention_id, "status": status}
