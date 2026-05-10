"""Agent endpoints (CONTRACTS.md §2.2)."""

from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.shared.supabase_client import get_client

router = APIRouter(prefix="/agents", tags=["agents"])


class InterventionRequestBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    trigger_reason: str = Field(default="churn_risk_high", min_length=1, max_length=200)


class InterventionRecommendationResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    account_id: str
    trigger_reason: str
    recommended_channel: Literal["email", "slack", "whatsapp", "voice_call"]
    recipient: str
    message_subject: str | None
    message_body: str
    playbook_id_used: str
    playbook_success_rate_at_decision: float
    agent_reasoning: str
    confidence: float


def _http_404(message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"error": "not_found", "message": message, "details": {}})


def _template_fill(tpl: str, *, champion_name: str, account_name: str) -> str:
    out = tpl.replace("{{champion}}", champion_name or "allí")
    out = out.replace("{{account}}", account_name or "tu equipo")
    return out


def _playbook_match_score(profile: dict[str, Any], industry: str, size: str) -> float:
    score = 0.0
    inds = profile.get("industry")
    if isinstance(inds, list) and industry in [str(x) for x in inds]:
        score += 10.0
    sizes = profile.get("size")
    if isinstance(sizes, list) and size in [str(x) for x in sizes]:
        score += 5.0
    return score


def _pick_playbook(rows: list[dict[str, Any]], industry: str, size: str) -> dict[str, Any] | None:
    if not rows:
        return None
    best: tuple[float, dict[str, Any]] | None = None
    for row in rows:
        profile = row.get("account_profile") or {}
        if not isinstance(profile, dict):
            profile = {}
        base = _playbook_match_score(profile, industry, size)
        sr = float(row.get("success_rate") or 0.0)
        used = int(row.get("times_used") or 0)
        tie = base + sr * 8.0 + min(used, 20) * 0.05
        if best is None or tie > best[0]:
            best = (tie, row)
    return best[1] if best else rows[0]


def _recipient_for_channel(
    channel: str,
    *,
    champion_email: str,
    csm_slack: str | None,
    csm_phone: str | None,
) -> str:
    if channel == "email":
        return champion_email or ""
    if channel == "slack":
        if csm_slack:
            return csm_slack.strip().lstrip("@")
        return champion_email or ""
    if channel in ("whatsapp", "voice_call"):
        if csm_phone and re.search(r"\d", csm_phone or ""):
            return csm_phone.strip()
        return champion_email or ""
    return champion_email or ""


def _normalize_channel(c: str) -> Literal["email", "slack", "whatsapp", "voice_call"]:
    if c in ("email", "slack", "whatsapp", "voice_call"):
        return c  # type: ignore[return-value]
    return "email"


@router.post("/intervention/{account_id}", response_model=InterventionRecommendationResponse)
def post_intervention_recommendation(
    account_id: str,
    payload: InterventionRequestBody,
) -> InterventionRecommendationResponse:
    """Elige un playbook desde `playbook_memory` y arma mensaje (sin persistir intervención)."""
    client = get_client()
    trigger = payload.trigger_reason or "churn_risk_high"

    acc = (
        client.table("accounts")
        .select(
            "id,name,industry,size,champion_name,champion_email,"
            "csm_team(phone,slack_handle,email)"
        )
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    rows = acc.data or []
    if not rows:
        raise _http_404("Account not found")

    row = rows[0]
    industry = str(row.get("industry") or "")
    size = str(row.get("size") or "")
    name = str(row.get("name") or "")
    champ = str(row.get("champion_name") or "")
    email = str(row.get("champion_email") or "")
    csm = row.get("csm_team")
    if isinstance(csm, list):
        csm = csm[0] if csm else None
    csm = csm if isinstance(csm, dict) else {}
    csm_slack = csm.get("slack_handle")
    csm_phone = csm.get("phone")

    pb_res = (
        client.table("playbook_memory")
        .select(
            "id,recommended_channel,message_template,success_rate,times_used,times_succeeded,account_profile"
        )
        .order("success_rate", desc=True)
        .limit(80)
        .execute()
    )
    pbs: list[dict[str, Any]] = pb_res.data or []
    chosen = _pick_playbook(pbs, industry, size)
    if not chosen:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "no_playbooks",
                "message": "No hay playbooks en playbook_memory",
                "details": {},
            },
        )

    channel = _normalize_channel(str(chosen.get("recommended_channel") or "email"))

    tpl = str(chosen.get("message_template") or "")
    body_text = _template_fill(tpl, champion_name=champ, account_name=name)
    sr = float(chosen.get("success_rate") or 0.0)
    used = int(chosen.get("times_used") or 0)
    ok = int(chosen.get("times_succeeded") or 0)

    recipient = _recipient_for_channel(
        channel,
        champion_email=email,
        csm_slack=str(csm_slack) if csm_slack else None,
        csm_phone=str(csm_phone) if csm_phone else None,
    )

    reasoning = (
        f"Playbook seleccionado por perfil ({industry}, {size}) y tasa histórica "
        f"{sr:.0%} ({ok}/{used} éxitos). Canal {channel} alineado con plantilla y datos de contacto disponibles."
    )
    confidence = min(0.95, 0.45 + sr * 0.55)

    return InterventionRecommendationResponse(
        account_id=str(row["id"]),
        trigger_reason=trigger,
        recommended_channel=channel,
        recipient=recipient,
        message_subject=None,
        message_body=body_text,
        playbook_id_used=str(chosen["id"]),
        playbook_success_rate_at_decision=sr,
        agent_reasoning=reasoning,
        confidence=round(confidence, 2),
    )
