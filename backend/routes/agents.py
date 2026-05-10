"""Agent endpoints (CONTRACTS.md §2.2 + Persona 2)."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
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
    OPEN_INTERVENTION_STATUSES,
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


# Lock por account_id para serializar requests concurrentes al mismo destino.
# React StrictMode dispara dos POSTs casi simultáneos; sin esto ambos pasan los
# checks de idempotencia (lectura) antes de que ninguno haya insertado, y
# terminan creando dos filas. El lock vive en memoria del proceso uvicorn —
# suficiente para single-worker dev/demo. Para multi-worker conviene un lock
# distribuido (Redis / advisory lock de Postgres), fuera de scope acá.
_ACCOUNT_LOCKS: dict[str, threading.Lock] = {}
_ACCOUNT_LOCKS_GUARD = threading.Lock()


def _account_lock(account_id: str) -> threading.Lock:
    with _ACCOUNT_LOCKS_GUARD:
        lock = _ACCOUNT_LOCKS.get(account_id)
        if lock is None:
            lock = threading.Lock()
            _ACCOUNT_LOCKS[account_id] = lock
        return lock


def _load_open_intervention(account_id: str) -> dict[str, Any] | None:
    """Devuelve cualquier intervención abierta (no terminal) para esta cuenta.

    Cubre dos casos:
    - Idempotencia para requests duplicados del frontend (StrictMode/double-click):
      en vez de tirar 409 por cool-off, devolvemos la fila existente y el modal
      sigue su flujo normal con el mismo `intervention_id`.
    - Defensa contra duplicados: cualquier estado no terminal cuenta (incluye
      `sent`, `delivered`, etc.); así un re-mount tardío tampoco crea otra fila.
    """
    sb = get_supabase()
    res = (
        sb.table("interventions")
        .select("*")
        .eq("account_id", account_id)
        .in_("status", list(OPEN_INTERVENTION_STATUSES))
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


@router.post("/intervention/run-all")
def run_all_interventions() -> dict:
    """Trigger placeholder for batch intervention automation.

    Stub endpoint — the teammate will wire up the actual automation logic here.
    For now, also cleans up any leftover `auto_batch_trigger` interventions from
    earlier test runs so that the per-account InterventionModal keeps working
    (it auto-closes if `hasActiveIntervention` is true on the AccountDetail).
    """
    sb = get_supabase()
    cleanup = (
        sb.table("interventions")
        .delete()
        .eq("trigger_reason", "auto_batch_trigger")
        .in_("status", list(OPEN_INTERVENTION_STATUSES))
        .execute()
    )
    cleaned = len(getattr(cleanup, "data", None) or [])
    return {"triggered": 0, "skipped": 0, "errors": [], "cleaned_up": cleaned}


@router.post("/intervention/{account_id}")
def intervention(
    account_id: str,
    body: InterventionRequest,
    background: BackgroundTasks,
) -> dict:
    """Run the Intervention Engine and notify CSM via Slack in the background."""
    # Lock por cuenta + idempotencia: si ya existe una intervención abierta para
    # esta cuenta, devolvemos esa misma fila. El lock evita que dos POSTs
    # concurrentes (StrictMode, doble click) lean ambos "no existe" antes de
    # que el primero alcance a insertar.
    with _account_lock(account_id):
        existing = _load_open_intervention(account_id)
        if existing:
            logger.debug(
                "intervention idempotency hit for %s — returning existing %s",
                account_id,
                existing.get("intervention_id"),
            )
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
