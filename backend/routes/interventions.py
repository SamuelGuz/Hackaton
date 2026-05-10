"""Interventions list + outcome endpoints (CONTRACTS.md §2.3)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.routes.schemas_interventions import (
    InterventionListItem,
    InterventionsListResponse,
    OutcomeRequest,
    OutcomeResponse,
    PlaybookUpdateInfo,
)
from backend.shared.supabase_client import get_client

router = APIRouter(prefix="/interventions", tags=["interventions"])


def _http_error(status: int, code: str, message: str, details: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"error": code, "message": message, "details": details or {}},
    )


def _flatten(row: dict[str, Any]) -> dict[str, Any]:
    """Pop the joined `accounts` sub-object and flatten its `name` into `account_name`."""
    accounts = row.pop("accounts", None) or {}
    name = accounts.get("name") if isinstance(accounts, dict) else None
    row["account_name"] = name or "—"
    return row


@router.get("", response_model=InterventionsListResponse)
def list_interventions(
    status: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    account_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> InterventionsListResponse:
    client = get_client()

    q = client.table("interventions").select("*, accounts(name)", count="exact")
    if status:
        q = q.eq("status", status)
    if channel:
        q = q.eq("channel", channel)
    if account_id:
        q = q.eq("account_id", account_id)

    res = (
        q.order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    rows = list(res.data or [])
    total = int(res.count) if getattr(res, "count", None) is not None else len(rows)

    items: list[InterventionListItem] = []
    for raw in rows:
        flat = _flatten(dict(raw))
        try:
            items.append(InterventionListItem(**flat))
        except Exception:
            # Skip rows that don't match the expected shape — keeps the endpoint resilient.
            continue

    return InterventionsListResponse(interventions=items, total=total)


@router.post("/{intervention_id}/outcome", response_model=OutcomeResponse)
def record_outcome(intervention_id: str, payload: OutcomeRequest) -> OutcomeResponse:
    client = get_client()

    inv_res = (
        client.table("interventions")
        .select("id,playbook_id_used,outcome")
        .eq("id", intervention_id)
        .limit(1)
        .execute()
    )
    inv_rows = inv_res.data or []
    if not inv_rows:
        raise _http_error(404, "not_found", "Intervention not found", {"intervention_id": intervention_id})

    inv = inv_rows[0]
    if inv.get("outcome"):
        raise _http_error(409, "already_recorded", "Outcome already recorded for this intervention",
                          {"intervention_id": intervention_id, "current_outcome": inv["outcome"]})

    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload = {
        "outcome": payload.outcome,
        "outcome_notes": payload.outcome_notes,
        "outcome_recorded_at": now_iso,
    }
    client.table("interventions").update(update_payload).eq("id", intervention_id).execute()

    playbook_update: PlaybookUpdateInfo | None = None
    playbook_id = inv.get("playbook_id_used")
    if playbook_id:
        pb_res = (
            client.table("playbook_memory")
            .select("id,times_used,times_succeeded,success_rate")
            .eq("id", playbook_id)
            .limit(1)
            .execute()
        )
        pb_rows = pb_res.data or []
        if pb_rows:
            pb = pb_rows[0]
            prev_rate = float(pb.get("success_rate") or 0.0)
            new_times_used = int(pb.get("times_used") or 0) + 1
            new_times_succeeded = int(pb.get("times_succeeded") or 0)
            if payload.outcome in ("success", "partial"):
                new_times_succeeded += 1
            new_rate = round(new_times_succeeded / new_times_used, 4) if new_times_used else 0.0
            deprecated = new_rate < 0.30 and new_times_used >= 5

            client.table("playbook_memory").update({
                "times_used": new_times_used,
                "times_succeeded": new_times_succeeded,
                "success_rate": new_rate,
            }).eq("id", playbook_id).execute()

            playbook_update = PlaybookUpdateInfo(
                playbook_id=str(playbook_id),
                previous_success_rate=prev_rate,
                new_success_rate=new_rate,
                times_used=new_times_used,
                deprecated=deprecated,
            )

    return OutcomeResponse(
        intervention_id=intervention_id,
        outcome_recorded=True,
        playbook_updated=playbook_update,
    )
