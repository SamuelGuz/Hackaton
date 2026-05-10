"""Twilio <-> ElevenLabs ConvAI bridge for PSTN voice calls."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from fastapi import WebSocket
from supabase import Client, create_client
from twilio.rest import Client as TwilioClient
import websockets

from .elevenlabs_client import get_convai_signed_url

logger = logging.getLogger(__name__)


def _sb() -> Client:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"]
    return create_client(os.environ["SUPABASE_URL"], key)


def _twilio_client() -> TwilioClient:
    return TwilioClient(
        os.environ["TWILIO_ACCOUNT_SID"],
        os.environ["TWILIO_AUTH_TOKEN"],
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _api_base_url() -> str:
    base = os.environ.get("API_BASE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("API_BASE_URL is required for Twilio callbacks")
    return base


def _public_ws_base_url() -> str:
    base = os.environ.get("API_PUBLIC_WS_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("API_PUBLIC_WS_URL is required for Twilio media stream")
    return base


def start_twilio_call(intervention_id: str, to_phone: str) -> str:
    """Create outbound PSTN call in Twilio and return Call SID."""
    twiml_query = urlencode({"intervention_id": intervention_id})
    twiml_url = f"{_api_base_url()}/api/v1/dispatch-intervention/twilio/twiml?{twiml_query}"
    status_url = f"{_api_base_url()}/api/v1/dispatch-intervention/twilio/status"
    call = _twilio_client().calls.create(
        to=to_phone,
        from_=os.environ["TWILIO_FROM_NUMBER"],
        url=twiml_url,
        method="GET",
        status_callback=status_url,
        status_callback_event=["answered", "completed"],
        status_callback_method="POST",
    )
    return str(call.sid)


def end_twilio_call(call_sid: str) -> None:
    """Force-complete an in-progress Twilio call."""
    _twilio_client().calls(call_sid).update(status="completed")


def build_twiml(intervention_id: str) -> str:
    """Return TwiML that connects Twilio audio to our websocket bridge."""
    query = urlencode({"intervention_id": intervention_id})
    stream_url = (
        f"{_public_ws_base_url()}/api/v1/dispatch-intervention/twilio/media-stream?{query}"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="{stream_url}" />'
        "</Connect></Response>"
    )


def _fetch_dynamic_vars(intervention_id: str) -> dict[str, str]:
    """Load dynamic variables for ElevenLabs conversation init."""
    sb = _sb()
    inv = (
        sb.table("interventions")
        .select("trigger_reason,message_body,account_id")
        .eq("id", intervention_id)
        .limit(1)
        .execute()
    )
    inv_row = (getattr(inv, "data", None) or [{}])[0]
    account_id = inv_row.get("account_id")

    account_name = ""
    champion_name = ""
    csm_name = ""
    if account_id:
        acc = (
            sb.table("accounts")
            .select("name,champion_name,csm_assigned")
            .eq("id", account_id)
            .limit(1)
            .execute()
        )
        acc_row = (getattr(acc, "data", None) or [{}])[0]
        account_name = str(acc_row.get("name") or "")
        champion_name = str(acc_row.get("champion_name") or "")
        csm_name = str(acc_row.get("csm_assigned") or "")

    trigger_reason = str(inv_row.get("trigger_reason") or "churn_risk_high")
    message_body = str(inv_row.get("message_body") or "")

    return {
        "trigger_reason_label": trigger_reason,
        "top_signals_text": "Caida de logins y tickets sin resolver",
        "predicted_churn_reason": "adoption_drop_unresolved_tickets",
        "message_body": message_body,
        "nombre_persona": champion_name or "cliente",
        "empresa": account_name or "empresa",
        "csm_name": csm_name or "CSM",
        "champion_name": champion_name or "cliente",
        "company_name": account_name or "empresa",
    }


def _update_intervention(intervention_id: str, data: dict[str, Any]) -> None:
    _sb().table("interventions").update(data).eq("id", intervention_id).execute()


async def bridge(twilio_ws: WebSocket, intervention_id: str) -> None:
    """Bridge Twilio media websocket with ElevenLabs conversation websocket."""
    await twilio_ws.accept()
    stream_sid: str | None = None
    dyn = _fetch_dynamic_vars(intervention_id)
    signed_url = get_convai_signed_url(os.environ.get("ELEVENLABS_AGENT_ID"))

    async with websockets.connect(signed_url, max_size=None) as eleven_ws:
        await eleven_ws.send(
            json.dumps(
                {
                    "type": "conversation_initiation_client_data",
                    "dynamic_variables": dyn,
                }
            )
        )

        async def twilio_to_eleven() -> None:
            nonlocal stream_sid
            while True:
                raw = await twilio_ws.receive_text()
                data = json.loads(raw)
                event = data.get("event")
                if event == "start":
                    stream_sid = data.get("start", {}).get("streamSid")
                    continue
                if event == "media":
                    payload = data.get("media", {}).get("payload")
                    if payload:
                        await eleven_ws.send(json.dumps({"user_audio_chunk": payload}))
                    continue
                if event == "stop":
                    break

        async def eleven_to_twilio() -> None:
            while True:
                raw = await eleven_ws.recv()
                msg = json.loads(raw)

                audio = msg.get("audio_event", {}) if isinstance(msg, dict) else {}
                audio_b64 = audio.get("audio_base_64")
                if audio_b64 and stream_sid:
                    await twilio_ws.send_text(
                        json.dumps(
                            {
                                "event": "media",
                                "streamSid": stream_sid,
                                "media": {"payload": audio_b64},
                            }
                        )
                    )
                    continue

                if msg.get("type") == "interruption_event" and stream_sid:
                    await twilio_ws.send_text(
                        json.dumps({"event": "clear", "streamSid": stream_sid})
                    )

        try:
            await asyncio.gather(twilio_to_eleven(), eleven_to_twilio())
        except Exception as exc:  # noqa: BLE001
            logger.warning("Twilio bridge closed with error: %s", exc)
        finally:
            _update_intervention(
                intervention_id,
                {
                    "status": "delivered",
                    "delivered_at": _now(),
                },
            )
