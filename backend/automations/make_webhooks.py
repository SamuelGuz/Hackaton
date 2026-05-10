"""Make.com webhook dispatcher."""
import os
import httpx


def _post(url: str, payload: dict) -> dict:
    resp = httpx.post(url, json=payload, timeout=10)
    resp.raise_for_status()
    try:
        return resp.json()
    except Exception:
        return {}


def send_email(
    intervention_id: str,
    to: str,
    subject: str,
    body: str,
    from_name: str,
    from_email: str,
    callback_url: str,
) -> dict:
    return _post(
        os.environ["MAKE_WEBHOOK_EMAIL"],
        {
            "intervention_id": intervention_id,
            "to_email": to,
            "subject": subject,
            "body": body,
            "from_name": from_name,
            "from_email": from_email,
            "callback_url": callback_url,
        },
    )


def send_slack(
    intervention_id: str,
    channel: str,
    message: str,
    csm_to_mention: str,
    callback_url: str,
) -> dict:
    return _post(
        os.environ["MAKE_WEBHOOK_SLACK"],
        {
            "intervention_id": intervention_id,
            "channel": channel,
            "message": message,
            "csm_to_mention": csm_to_mention,
            "callback_url": callback_url,
        },
    )


def send_whatsapp(
    intervention_id: str,
    to_phone: str,
    nombre_cliente: str,
    nombre_empresa: str,
    motivo_alerta: str,
    callback_url: str,
) -> dict:
    return _post(
        os.environ["MAKE_WEBHOOK_WHATSAPP"],
        {
            "intervention_id": intervention_id,
            "to_phone": to_phone,
            "nombre_cliente": nombre_cliente,
            "nombre_empresa": nombre_empresa,
            "motivo_alerta": motivo_alerta,
            "callback_url": callback_url,
        },
    )


def send_voice(
    intervention_id: str,
    to_phone: str,
    audio_url: str,
    fallback_text: str,
    callback_url: str,
) -> dict:
    return _post(
        os.environ["MAKE_WEBHOOK_VOICE"],
        {
            "intervention_id": intervention_id,
            "to_phone": to_phone,
            "audio_url": audio_url,
            "fallback_text": fallback_text,
            "callback_url": callback_url,
        },
    )
