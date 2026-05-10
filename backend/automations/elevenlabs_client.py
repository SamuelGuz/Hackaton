"""ElevenLabs voice synthesis client."""
import os
import httpx

_BASE = "https://api.elevenlabs.io/v1"


def generate_audio(text: str, voice_id: str | None = None) -> bytes:
    vid = voice_id or os.environ["ELEVENLABS_VOICE_ID"]
    resp = httpx.post(
        f"{_BASE}/text-to-speech/{vid}",
        headers={
            "xi-api-key": os.environ["ELEVENLABS_API_KEY"],
            "Accept": "audio/mpeg",
        },
        json={
            "text": text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.content
