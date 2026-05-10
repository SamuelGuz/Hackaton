"""ElevenLabs client — sólo bootstrap de sesión ConvAI.

El TTS pre-renderizado se eliminó: el frontend abre la sesión ConvAI directamente
con el `signed_url` y la llamada se hace en vivo.
"""
import os
import urllib.parse

import httpx

_BASE = "https://api.elevenlabs.io/v1"


def get_convai_signed_url(agent_id: str | None = None) -> str:
    """Return a signed websocket URL for a ConvAI conversation session."""
    aid = agent_id or os.environ["ELEVENLABS_AGENT_ID"]
    encoded_agent_id = urllib.parse.quote(aid, safe="")
    url = f"{_BASE}/convai/conversation/get_signed_url?agent_id={encoded_agent_id}"
    resp = httpx.get(
        url,
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        timeout=20,
    )
    resp.raise_for_status()
    payload = resp.json()
    signed_url = payload.get("signed_url")
    if not signed_url:
        raise RuntimeError("missing signed_url in ElevenLabs response")
    return str(signed_url)
