"""Async batch agent runner.

Processes the N newest accounts in parallel through the full agent pipeline
(Crystal Ball -> Expansion -> Intervention). One worker thread per account; the
three steps run sequentially within a worker.

Public API:
    submit_batch(limit, trigger_reason) -> BatchSubmitResult
    get_batch_status(batch_id) -> BatchStatus | None
"""

from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

from backend.agents.crystal_ball import run_crystal_ball
from backend.agents.expansion import run_expansion
from backend.agents.intervention_engine import (
    CoolOffActive,
    run_intervention,
)
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

AccountStepStatus = Literal["queued", "running", "done", "failed", "skipped"]
StepName = Literal["crystal_ball", "expansion", "intervention"]
AccountOverallStatus = Literal["queued", "running", "done", "failed"]
BatchOverallStatus = Literal["queued", "running", "done", "partial", "failed"]


class AccountStepResult(BaseModel):
    step: StepName
    status: AccountStepStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    result_summary: dict | None = None


class AccountBatchResult(BaseModel):
    account_id: str
    account_name: str | None = None
    overall_status: AccountOverallStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    steps: list[AccountStepResult]
    intervention_id: str | None = None


class BatchStatus(BaseModel):
    batch_id: str
    created_at: datetime
    overall_status: BatchOverallStatus
    trigger_reason: str
    accounts: list[AccountBatchResult]


class BatchSubmitResult(BaseModel):
    batch_id: str
    accounts_queued: int
    poll_url: str


# ---------------------------------------------------------------------------
# Module state
# ---------------------------------------------------------------------------

_BATCHES: dict[str, BatchStatus] = {}
_BATCHES_LOCK = threading.Lock()

_EXECUTOR: ThreadPoolExecutor | None = None
_EXECUTOR_LOCK = threading.Lock()

_STEPS: tuple[StepName, ...] = ("crystal_ball", "expansion", "intervention")


def _get_executor() -> ThreadPoolExecutor:
    global _EXECUTOR
    if _EXECUTOR is None:
        with _EXECUTOR_LOCK:
            if _EXECUTOR is None:
                _EXECUTOR = ThreadPoolExecutor(
                    max_workers=4,
                    thread_name_prefix="batch-agent",
                )
    return _EXECUTOR


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# State helpers (must run under _BATCHES_LOCK)
# ---------------------------------------------------------------------------


def _find_account(batch: BatchStatus, account_id: str) -> AccountBatchResult:
    for acc in batch.accounts:
        if acc.account_id == account_id:
            return acc
    raise KeyError(account_id)


def _find_step(account: AccountBatchResult, step: StepName) -> AccountStepResult:
    for s in account.steps:
        if s.step == step:
            return s
    raise KeyError(step)


def _set_account_running(batch_id: str, account_id: str) -> None:
    with _BATCHES_LOCK:
        batch = _BATCHES.get(batch_id)
        if batch is None:
            return
        acc = _find_account(batch, account_id)
        acc.overall_status = "running"
        acc.started_at = _now()
        if batch.overall_status == "queued":
            batch.overall_status = "running"


def _mark_step_running(batch_id: str, account_id: str, step: StepName) -> None:
    with _BATCHES_LOCK:
        batch = _BATCHES.get(batch_id)
        if batch is None:
            return
        s = _find_step(_find_account(batch, account_id), step)
        s.status = "running"
        s.started_at = _now()


def _mark_step_done(
    batch_id: str,
    account_id: str,
    step: StepName,
    summary: dict,
) -> None:
    with _BATCHES_LOCK:
        batch = _BATCHES.get(batch_id)
        if batch is None:
            return
        s = _find_step(_find_account(batch, account_id), step)
        s.status = "done"
        s.finished_at = _now()
        s.result_summary = summary


def _mark_step_failed(
    batch_id: str,
    account_id: str,
    step: StepName,
    error: str,
    *,
    skipped: bool = False,
) -> None:
    with _BATCHES_LOCK:
        batch = _BATCHES.get(batch_id)
        if batch is None:
            return
        s = _find_step(_find_account(batch, account_id), step)
        s.status = "skipped" if skipped else "failed"
        s.finished_at = _now()
        s.error = error


def _set_intervention_id(batch_id: str, account_id: str, intervention_id: str | None) -> None:
    if intervention_id is None:
        return
    with _BATCHES_LOCK:
        batch = _BATCHES.get(batch_id)
        if batch is None:
            return
        _find_account(batch, account_id).intervention_id = intervention_id


def _finalize_account(batch_id: str, account_id: str) -> None:
    with _BATCHES_LOCK:
        batch = _BATCHES.get(batch_id)
        if batch is None:
            return
        acc = _find_account(batch, account_id)
        any_failed = any(s.status == "failed" for s in acc.steps)
        all_terminal = all(s.status in ("done", "skipped", "failed") for s in acc.steps)
        if any_failed:
            acc.overall_status = "failed"
        elif all_terminal:
            acc.overall_status = "done"
        acc.finished_at = _now()

        # Recompute batch-level status if every account is finished.
        if all(
            a.overall_status in ("done", "failed") for a in batch.accounts
        ):
            statuses = {a.overall_status for a in batch.accounts}
            if statuses == {"done"}:
                batch.overall_status = "done"
            elif statuses == {"failed"}:
                batch.overall_status = "failed"
            else:
                batch.overall_status = "partial"


# ---------------------------------------------------------------------------
# Per-account worker
# ---------------------------------------------------------------------------


def _process_account(
    batch_id: str,
    account_id: str,
    account_name: str | None,
    trigger_reason: str,
) -> None:
    logger.info(
        "batch=%s account=%s starting pipeline (name=%s)",
        batch_id,
        account_id,
        account_name,
    )
    _set_account_running(batch_id, account_id)

    # ----- Crystal Ball -----
    _mark_step_running(batch_id, account_id, "crystal_ball")
    logger.info("batch=%s account=%s step=crystal_ball running", batch_id, account_id)
    try:
        cb_out = run_crystal_ball(account_id, force_refresh=False)
        summary = {
            "score": cb_out.churn_risk_score,
            "confidence": cb_out.confidence,
        }
        _mark_step_done(batch_id, account_id, "crystal_ball", summary)
        logger.info("batch=%s account=%s step=crystal_ball done", batch_id, account_id)
    except Exception as exc:  # noqa: BLE001
        _mark_step_failed(
            batch_id, account_id, "crystal_ball", f"{type(exc).__name__}: {exc}"
        )
        logger.exception(
            "batch=%s account=%s step=crystal_ball failed", batch_id, account_id
        )

    # ----- Expansion -----
    _mark_step_running(batch_id, account_id, "expansion")
    logger.info("batch=%s account=%s step=expansion running", batch_id, account_id)
    try:
        ex_out = run_expansion(account_id, force_refresh=False)
        summary = {
            "expansion_score": ex_out.expansion_score,
            "ready_to_expand": ex_out.ready_to_expand,
            "recommended_plan": ex_out.recommended_plan,
        }
        _mark_step_done(batch_id, account_id, "expansion", summary)
        logger.info("batch=%s account=%s step=expansion done", batch_id, account_id)
    except Exception as exc:  # noqa: BLE001
        _mark_step_failed(
            batch_id, account_id, "expansion", f"{type(exc).__name__}: {exc}"
        )
        logger.exception(
            "batch=%s account=%s step=expansion failed", batch_id, account_id
        )

    # ----- Intervention -----
    _mark_step_running(batch_id, account_id, "intervention")
    logger.info("batch=%s account=%s step=intervention running", batch_id, account_id)
    try:
        iv_out = run_intervention(account_id, trigger_reason)
        summary = {
            "intervention_id": iv_out.intervention_id,
            "channel": iv_out.recommended_channel,
            "status": iv_out.status,
            "requires_approval": iv_out.requires_approval,
            "confidence": iv_out.confidence,
        }
        _mark_step_done(batch_id, account_id, "intervention", summary)
        _set_intervention_id(batch_id, account_id, iv_out.intervention_id)
        logger.info(
            "batch=%s account=%s step=intervention done id=%s",
            batch_id,
            account_id,
            iv_out.intervention_id,
        )
    except CoolOffActive as exc:
        _mark_step_failed(
            batch_id,
            account_id,
            "intervention",
            f"CoolOffActive: {exc}",
            skipped=True,
        )
        logger.info(
            "batch=%s account=%s step=intervention skipped (cool-off)",
            batch_id,
            account_id,
        )
    except Exception as exc:  # noqa: BLE001
        _mark_step_failed(
            batch_id, account_id, "intervention", f"{type(exc).__name__}: {exc}"
        )
        logger.exception(
            "batch=%s account=%s step=intervention failed", batch_id, account_id
        )

    _finalize_account(batch_id, account_id)
    logger.info("batch=%s account=%s pipeline finished", batch_id, account_id)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def submit_batch(
    limit: int = 4,
    trigger_reason: str = "churn_risk_high",
) -> BatchSubmitResult:
    """Queue the N newest accounts for parallel agent processing."""
    sb = get_supabase()
    res = (
        sb.table("accounts")
        .select("id, name")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        raise RuntimeError("no accounts found")

    batch_id = str(uuid.uuid4())
    created_at = _now()

    accounts: list[AccountBatchResult] = []
    for row in rows:
        account_id = str(row.get("id"))
        accounts.append(
            AccountBatchResult(
                account_id=account_id,
                account_name=row.get("name"),
                overall_status="queued",
                steps=[
                    AccountStepResult(step=step, status="queued")
                    for step in _STEPS
                ],
            )
        )

    batch = BatchStatus(
        batch_id=batch_id,
        created_at=created_at,
        overall_status="queued",
        trigger_reason=trigger_reason,
        accounts=accounts,
    )

    with _BATCHES_LOCK:
        _BATCHES[batch_id] = batch

    executor = _get_executor()
    for acc in accounts:
        executor.submit(
            _process_account,
            batch_id,
            acc.account_id,
            acc.account_name,
            trigger_reason,
        )

    logger.info(
        "batch=%s submitted accounts=%d trigger=%s",
        batch_id,
        len(accounts),
        trigger_reason,
    )

    return BatchSubmitResult(
        batch_id=batch_id,
        accounts_queued=len(accounts),
        poll_url=f"/api/v1/agents/batch-process/{batch_id}",
    )


def get_batch_status(batch_id: str) -> BatchStatus | None:
    """Return a deep copy of the batch state to avoid mutation races."""
    with _BATCHES_LOCK:
        batch = _BATCHES.get(batch_id)
        if batch is None:
            return None
        return batch.model_copy(deep=True)
