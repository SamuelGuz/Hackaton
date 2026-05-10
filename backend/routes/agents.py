"""Agent endpoints (CONTRACTS.md §2.2 + Persona 2)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

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
from backend.agents.intervention_engine import (
    AccountNotFound,
    CoolOffActive,
    InterventionError,
    InterventionOutput,
    InvalidOutputError,
    SnapshotMissing,
    run_intervention,
)
from backend.automations.slack_notifier import _load_account, notify_csm
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


_IDEMPOTENCY_WINDOW_SECONDS = 30


def _load_fresh_intervention(account_id: str) -> dict[str, Any] | None:
    """Devuelve la intervención más reciente si fue creada en los últimos
    _IDEMPOTENCY_WINDOW_SECONDS segundos y sigue sin despachar.
    Previene la creación de duplicados por requests concurrentes (ej. React StrictMode).
    """
    sb = get_supabase()
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=_IDEMPOTENCY_WINDOW_SECONDS)
    ).isoformat()
    res = (
        sb.table("interventions")
        .select("*")
        .eq("account_id", account_id)
        .in_("status", ["pending", "pending_approval"])
        .gte("created_at", cutoff)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        return None
    row = rows[0]
    return {
        "intervention_id": row.get("id"),
        "account_id": row.get("account_id"),
        "trigger_reason": row.get("trigger_reason", ""),
        "recommended_channel": row.get("channel"),
        "recipient": row.get("recipient", ""),
        "message_subject": row.get("message_subject"),
        "message_body": row.get("message_body", ""),
        "playbook_id_used": row.get("playbook_id_used"),
        "playbook_success_rate_at_decision": None,
        "agent_reasoning": row.get("agent_reasoning", ""),
        "confidence": float(row.get("confidence_score") or 0.0),
        "requires_approval": bool(row.get("requires_approval")),
        "approval_reasoning": "",
        "status": row.get("status"),
        "auto_approved": bool(row.get("auto_approved")),
    }


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


class InterventionRequest(BaseModel):
    trigger_reason: str = Field(..., min_length=1)


@router.post("/intervention/{account_id}")
def intervention(
    account_id: str,
    body: InterventionRequest,
    background: BackgroundTasks,
) -> dict:
    """Run the Intervention Engine and notify CSM via Slack in the background."""
    # Idempotencia: si ya existe una intervención creada en los últimos
    # _IDEMPOTENCY_WINDOW_SECONDS segundos, devolver la misma en vez de crear un duplicado.
    # Protege contra dobles requests concurrentes (React StrictMode, double-click, etc.).
    existing = _load_fresh_intervention(account_id)
    if existing:
        logger.debug("intervention idempotency hit for %s — returning existing %s", account_id, existing.get("intervention_id"))
        return existing

    try:
        output: InterventionOutput = run_intervention(account_id, body.trigger_reason)
    except AccountNotFound:
        raise HTTPException(status_code=404, detail="account_not_found")
    except SnapshotMissing:
        raise HTTPException(
            status_code=409,
            detail="health_snapshot_missing — run crystal-ball or expansion first",
        )
    except CoolOffActive as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except InvalidOutputError:
        logger.exception("intervention engine returned invalid output for %s", account_id)
        raise HTTPException(status_code=500, detail="engine_invalid_output")
    except InterventionError as exc:
        logger.exception("intervention engine failed for %s", account_id)
        raise HTTPException(status_code=500, detail=str(exc))

    account = _load_account(account_id) or {}
    background.add_task(notify_csm, output, account)

    return output.model_dump()


class CrystalBallRequest(BaseModel):
    force_refresh: bool = False


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
