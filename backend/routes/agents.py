"""FastAPI routes for the agent endpoints (Persona 2)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.agents.crystal_ball import (
    CrystalBallError,
    MaxTurnsExceeded,
    run_crystal_ball,
)
from backend.agents.expansion import (
    ExpansionError,
    MaxTurnsExceeded as ExpansionMaxTurnsExceeded,
    run_expansion,
)
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


class CrystalBallRequest(BaseModel):
    force_refresh: bool = False


def _account_exists(account_id: str) -> bool:
    sb = get_supabase()
    res = (
        sb.table("accounts")
        .select("id")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    return bool(getattr(res, "data", None))


@router.post("/crystal-ball/{account_id}")
def crystal_ball(account_id: str, body: CrystalBallRequest | None = None) -> dict:
    if not _account_exists(account_id):
        raise HTTPException(status_code=404, detail="account_not_found")

    force_refresh = body.force_refresh if body is not None else False

    try:
        output = run_crystal_ball(account_id, force_refresh=force_refresh)
    except MaxTurnsExceeded:
        raise HTTPException(status_code=504, detail="max_turns_exceeded")
    except CrystalBallError as exc:
        logger.exception("Crystal Ball failed for %s", account_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "account_id": account_id,
        "churn_risk_score": output.churn_risk_score,
        "top_signals": [s.model_dump() for s in output.top_signals],
        "predicted_churn_reason": output.predicted_churn_reason,
        "confidence": output.confidence,
        "reasoning": output.reasoning,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


class ExpansionRequest(BaseModel):
    force_refresh: bool = False


@router.post("/expansion/{account_id}")
def expansion(account_id: str, body: ExpansionRequest | None = None) -> dict:
    if not _account_exists(account_id):
        raise HTTPException(status_code=404, detail="account_not_found")

    force_refresh = body.force_refresh if body is not None else False

    try:
        output = run_expansion(account_id, force_refresh=force_refresh)
    except ExpansionMaxTurnsExceeded:
        raise HTTPException(status_code=504, detail="max_turns_exceeded")
    except ExpansionError as exc:
        logger.exception("Expansion agent failed for %s", account_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "account_id": account_id,
        "expansion_score": output.expansion_score,
        "ready_to_expand": output.ready_to_expand,
        "recommended_plan": output.recommended_plan,
        "reasoning": output.reasoning,
        "suggested_upsell_message": output.suggested_upsell_message,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
