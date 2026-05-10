"""ElevenLabs clients for TTS and ConvAI session bootstrap."""
import os
import urllib.parse

import httpx

_BASE = "https://api.elevenlabs.io/v1"


def _api_key() -> str:
    return os.environ["ELEVENLABS_API_KEY"]


def _headers(accept: str | None = None) -> dict[str, str]:
    headers = {"xi-api-key": _api_key()}
    if accept:
        headers["Accept"] = accept
    return headers


def generate_audio(text: str, voice_id: str | None = None) -> bytes:
    vid = voice_id or os.environ["ELEVENLABS_VOICE_ID"]
    resp = httpx.post(
        f"{_BASE}/text-to-speech/{vid}",
        headers=_headers("audio/mpeg"),
        json={
            "text": text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.content


def get_convai_signed_url(agent_id: str | None = None) -> str:
    """Return a signed websocket URL for a ConvAI conversation session."""
    aid = agent_id or os.environ["ELEVENLABS_AGENT_ID"]
    encoded_agent_id = urllib.parse.quote(aid, safe="")
    url = f"{_BASE}/convai/conversation/get_signed_url?agent_id={encoded_agent_id}"
    resp = httpx.get(url, headers=_headers(), timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    signed_url = payload.get("signed_url")
    if not signed_url:
        raise RuntimeError("missing signed_url in ElevenLabs response")
    return str(signed_url)
