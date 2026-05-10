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
    status_query = urlencode({"intervention_id": intervention_id})
    status_url = (
        f"{_api_base_url()}/api/v1/dispatch-intervention/twilio/status?{status_query}"
    )
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
    """Return TwiML that connects Twilio audio to our websocket bridge.

    `intervention_id` se envia como `<Parameter>` (Twilio lo incluye en el
    `customParameters` del primer mensaje `start`). Asi no dependemos de la
    query string del URL, que algunos proxies/clients pueden perder.
    """
    stream_url = (
        f"{_public_ws_base_url()}/api/v1/dispatch-intervention/twilio/media-stream"
    )
    safe_id = (intervention_id or "").replace('"', "&quot;")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="{stream_url}">'
        f'<Parameter name="intervention_id" value="{safe_id}" />'
        "</Stream>"
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
            .select("name,champion_name,csm_team(name)")
            .eq("id", account_id)
            .limit(1)
            .execute()
        )
        acc_row = (getattr(acc, "data", None) or [{}])[0]
        account_name = str(acc_row.get("name") or "")
        champion_name = str(acc_row.get("champion_name") or "")
        csm_team = acc_row.get("csm_team")
        if isinstance(csm_team, dict):
            csm_name = str(csm_team.get("name") or "")
        elif isinstance(csm_team, list) and csm_team:
            csm_name = str((csm_team[0] or {}).get("name") or "")

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


async def bridge(twilio_ws: WebSocket) -> None:
    """Bridge Twilio media websocket with ElevenLabs conversation websocket.

    El `intervention_id` se obtiene del primer mensaje `start` que envia Twilio
    (en `start.customParameters`). El handshake WS no requiere query string.
    """
    logger.info(
        "[twilio-bridge] WS connect path=%s qs=%r client=%s",
        twilio_ws.scope.get("path"),
        twilio_ws.scope.get("query_string"),
        twilio_ws.client,
    )
    await twilio_ws.accept()
    logger.info("[twilio-bridge] WS accepted, waiting for Twilio start event")

    intervention_id: str = ""
    stream_sid: str | None = None
    call_sid: str | None = None

    while True:
        raw = await twilio_ws.receive_text()
        try:
            first = json.loads(raw)
        except Exception:  # noqa: BLE001
            logger.warning("[twilio-bridge] non-JSON message before start: %r", raw[:200])
            continue
        ev = first.get("event")
        logger.info("[twilio-bridge] pre-start event=%s keys=%s", ev, list(first.keys()))
        if ev == "connected":
            continue
        if ev == "start":
            start_data = first.get("start", {}) or {}
            stream_sid = start_data.get("streamSid")
            call_sid = start_data.get("callSid")
            params = start_data.get("customParameters", {}) or {}
            intervention_id = str(
                params.get("intervention_id")
                or first.get("customParameters", {}).get("intervention_id", "")
                or ""
            )
            logger.info(
                "[twilio-bridge] start streamSid=%s callSid=%s intervention_id=%s params=%s",
                stream_sid,
                call_sid,
                intervention_id,
                params,
            )
            break
        # Otros eventos pre-start se ignoran (e.g., 'mark')

    if not intervention_id:
        logger.error(
            "[twilio-bridge] start without intervention_id; closing. customParameters=%s",
            params if "params" in locals() else None,
        )
        await twilio_ws.close(code=1008)
        return

    try:
        dyn = _fetch_dynamic_vars(intervention_id)
        logger.info("[twilio-bridge] dynamic_vars loaded for %s: keys=%s", intervention_id, list(dyn.keys()))
    except Exception as exc:  # noqa: BLE001
        logger.exception("[twilio-bridge] failed to load dynamic vars: %s", exc)
        await twilio_ws.close(code=1011)
        return

    try:
        signed_url = get_convai_signed_url(os.environ.get("ELEVENLABS_AGENT_ID"))
        logger.info("[twilio-bridge] got ElevenLabs signed_url")
    except Exception as exc:  # noqa: BLE001
        logger.exception("[twilio-bridge] failed to get ElevenLabs signed_url: %s", exc)
        await twilio_ws.close(code=1011)
        return

    async with websockets.connect(signed_url, max_size=None) as eleven_ws:
        await eleven_ws.send(
            json.dumps(
                {
                    "type": "conversation_initiation_client_data",
                    "dynamic_variables": dyn,
                }
            )
        )
        logger.info("[twilio-bridge] sent conversation_initiation_client_data to ElevenLabs")

        async def twilio_to_eleven() -> None:
            nonlocal stream_sid
            while True:
                raw = await twilio_ws.receive_text()
                try:
                    data = json.loads(raw)
                except Exception:  # noqa: BLE001
                    continue
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
                    logger.info("[twilio-bridge] received stop event from Twilio")
                    break

        async def eleven_to_twilio() -> None:
            while True:
                raw = await eleven_ws.recv()
                try:
                    msg = json.loads(raw)
                except Exception:  # noqa: BLE001
                    continue

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
            logger.warning("[twilio-bridge] closed with error: %s", exc)
        finally:
            try:
                _update_intervention(
                    intervention_id,
                    {
                        "status": "delivered",
                        "delivered_at": _now(),
                    },
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("[twilio-bridge] failed to update intervention on close: %s", exc)
