"""Channel router — picks email/slack/whatsapp/voice."""
import logging
import os

logger = logging.getLogger(__name__)
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, Form
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from supabase import create_client, Client

from . import make_webhooks, twilio_bridge

router = APIRouter(prefix="/dispatch-intervention", tags=["dispatch"])

_AUDIO_BUCKET = "audio"


@router.get("/whatsapp/verify", response_class=PlainTextResponse)
def whatsapp_verify(
    hub_mode: str = Query(alias="hub.mode", default=""),
    hub_verify_token: str = Query(alias="hub.verify_token", default=""),
    hub_challenge: str = Query(alias="hub.challenge", default=""),
):
    """Meta webhook verification. Set WHATSAPP_VERIFY_TOKEN in .env."""
    expected = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
    if hub_mode == "subscribe" and hub_verify_token == expected:
        return hub_challenge
    raise HTTPException(status_code=403, detail="Verification failed")


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
    direction: str = "inbound"
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
    twilio_call_sid: str | None = None
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
            if not body.recipient or not re.match(r"^\+\d{8,15}$", body.recipient.strip()):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "invalid_payload",
                        "message": "voice_call requires recipient in E.164 format (+...)",
                    },
                )
            twilio_call_sid = twilio_bridge.start_twilio_call(
                body.intervention_id, body.recipient.strip()
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
    if twilio_call_sid:
        update["external_id"] = twilio_call_sid

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
    if twilio_call_sid:
        response["session_mode"] = "twilio_pstn"
        response["call_sid"] = twilio_call_sid
        response["to_phone"] = body.recipient

    return response


@router.post("/multi", status_code=202)
def dispatch_intervention_multi(body: MultiDispatchRequest):
    """Despacha una intervención por múltiples canales en una sola request.

    Validación de status una sola vez. Cada canal corre independientemente.
    Para `voice_call` se dispara una llamada PSTN real por Twilio hacia `recipient`.
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
                if not ch.recipient or not re.match(r"^\+\d{8,15}$", ch.recipient.strip()):
                    results.append(
                        {
                            "channel": "voice_call",
                            "status": "failed",
                            "error": "voice_call requires recipient in E.164 format (+...)",
                        }
                    )
                    continue
                call_sid = twilio_bridge.start_twilio_call(
                    body.intervention_id, ch.recipient.strip()
                )
                results.append({
                    "channel": "voice_call",
                    "status": "delivered",
                    "call_sid": call_sid,
                    "to_phone": ch.recipient.strip(),
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


@router.get("/twilio/twiml")
def twilio_twiml(intervention_id: str):
    xml = twilio_bridge.build_twiml(intervention_id)
    return Response(content=xml, media_type="application/xml")


@router.websocket("/twilio/media-stream")
async def twilio_media_stream(ws: WebSocket, intervention_id: str):
    await twilio_bridge.bridge(ws, intervention_id)


@router.post("/twilio/status")
def twilio_status_callback(
    CallSid: str = Form(""),
    CallStatus: str = Form(""),
    intervention_id: str = Form(""),
):
    call_status = (CallStatus or "").strip().lower()
    update: dict = {"external_id": CallSid}
    if call_status in ("in-progress", "answered"):
        update["status"] = "delivered"
        update["delivered_at"] = _now()
    elif call_status in ("failed", "busy", "no-answer", "canceled"):
        update["status"] = "failed"
        update["outcome_notes"] = f"twilio_call_status:{call_status}"

    if intervention_id:
        _update_intervention(intervention_id, update)
        return {"received": True}

    if CallSid:
        _sb().table("interventions").update(update).eq("external_id", CallSid).execute()
    return {"received": True}


class HangupPayload(BaseModel):
    intervention_id: str


@router.post("/twilio/hangup")
def twilio_hangup(body: HangupPayload):
    row = (
        _sb()
        .table("interventions")
        .select("external_id")
        .eq("id", body.intervention_id)
        .limit(1)
        .execute()
    )
    rows = getattr(row, "data", None) or []
    if not rows or not rows[0].get("external_id"):
        raise HTTPException(
            status_code=404,
            detail={"error": "call_not_found", "message": "No Twilio call_sid found"},
        )
    twilio_bridge.end_twilio_call(str(rows[0]["external_id"]))
    return {"ok": True, "intervention_id": body.intervention_id}


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

    # Guardar conversación
    sb.table("conversations").insert({
        "account_id": account_id,
        "channel": body.channel,
        "direction": body.direction,
        "participants": [body.sender],
        "content": body.content,
        "occurred_at": now,
        "intervention_id": intervention_id,
    }).execute()

    # Solo inferir outcome y marcar responded cuando el cliente responde (inbound)
    if intervention_id and body.direction == "inbound":
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


class InboundMessageRequest(BaseModel):
    from_phone: str
    message: str
    received_at: Optional[str] = None


@router.post("/inbound-message")
def receive_inbound_message(body: InboundMessageRequest):
    """
    Recibe un WhatsApp inbound, guarda en conversations y devuelve
    el historial completo formateado para Claude (roles: user/assistant).
    n8n llama esto cuando el cliente responde; usa el historial para generar
    la siguiente respuesta de la conversación.
    """
    sb = _sb()
    now = body.received_at or _now()

    # Normalizar teléfono: asegurar formato E.164
    phone = body.from_phone.strip()
    if not phone.startswith("+"):
        phone = "+" + phone

    # Buscar intervención activa por número de teléfono del champion
    # Buscamos en accounts por champion_phone y tomamos la intervención más reciente
    # que esté en estado activo (sent, delivered, responded)
    acc_res = (
        sb.table("accounts")
        .select("id,name,champion_name,champion_phone")
        .eq("champion_phone", phone)
        .limit(1)
        .execute()
    )
    account = (acc_res.data or [None])[0]

    if not account:
        raise HTTPException(
            status_code=404,
            detail={"error": "account_not_found", "message": f"No account found for phone {phone}"},
        )

    account_id = account["id"]

    # Intervención más reciente activa para esta cuenta por WhatsApp
    inv_res = (
        sb.table("interventions")
        .select("id,message_body,status,channel")
        .eq("account_id", account_id)
        .eq("channel", "whatsapp")
        .in_("status", ["sent", "delivered", "responded"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    intervention = (inv_res.data or [None])[0]

    if not intervention:
        raise HTTPException(
            status_code=404,
            detail={"error": "intervention_not_found", "message": "No active whatsapp intervention for this number"},
        )

    intervention_id = intervention["id"]

    # Guardar el mensaje inbound en conversations
    sb.table("conversations").insert({
        "account_id": account_id,
        "channel": "whatsapp",
        "direction": "inbound",
        "participants": [phone],
        "content": body.message,
        "occurred_at": now,
        "intervention_id": intervention_id,
    }).execute()

    # Marcar intervención como responded
    _update_intervention(intervention_id, {"status": "responded", "responded_at": now})

    # Construir historial para Claude filtrado por intervention_id
    history = [{"role": "assistant", "content": intervention["message_body"]}]

    conv_res = (
        sb.table("conversations")
        .select("direction,content,occurred_at")
        .eq("intervention_id", intervention_id)
        .order("occurred_at", desc=False)
        .execute()
    )
    for conv in conv_res.data or []:
        role = "user" if conv["direction"] == "inbound" else "assistant"
        history.append({"role": role, "content": conv["content"]})

    return {
        "intervention_id": intervention_id,
        "account_id": account_id,
        "account_name": account["name"],
        "champion_name": account["champion_name"],
        "to_phone": phone,
        "conversation_history": history,
        "turn": len(history),
    }


@router.get("/approve")
def approve_intervention(intervention_id: str, action: str):
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail={"error": "invalid_action", "message": "action must be approve or reject"})

    status = "approved" if action == "approve" else "rejected"
    _update_intervention(intervention_id, {"status": status})
    return {"intervention_id": intervention_id, "status": status}
