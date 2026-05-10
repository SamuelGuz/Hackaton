"""Playbooks API routes (CONTRACTS.md §2.3)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from backend.shared.supabase_client import get_client

router = APIRouter(prefix="/playbooks", tags=["playbooks"])


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class PlaybookItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    account_profile: dict[str, Any]
    signal_pattern: dict[str, Any]
    recommended_channel: str
    message_template: str
    times_used: int
    times_succeeded: int
    success_rate: float
    version: int
    superseded_by: str | None = None
    supersedes: str | None = None
    replaced_at: str | None = None


class PlaybooksResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    playbooks: list[PlaybookItem]


class EvolutionEntry(BaseModel):
    version: int
    success_rate: float
    times_used: int
    as_of: str


class PlaybookHistoryResponse(BaseModel):
    playbook_id: str
    evolution: list[EvolutionEntry]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CHANNEL_LABELS: dict[str, str] = {
    "email": "Email",
    "slack": "Slack",
    "whatsapp": "WhatsApp",
    "voice_call": "Llamada personal",
}

_MAX_PLAYBOOKS = 200


def _synthesize_name(row: dict[str, Any], index: int) -> str:
    """Generate a human-readable name from playbook fields."""
    channel = str(row.get("recommended_channel") or "")
    label = _CHANNEL_LABELS.get(channel, channel.replace("_", " ").title())

    profile: dict[str, Any] = row.get("account_profile") or {}
    industries: list[str] = profile.get("industry") or []
    sizes: list[str] = profile.get("size") or []

    parts: list[str] = []
    if industries:
        parts.append(", ".join(str(i) for i in industries[:2]))
    if sizes:
        parts.append(", ".join(str(s) for s in sizes[:2]))

    context = " · ".join(parts) if parts else "General"
    number = str(index + 1).zfill(3)
    return f"P-{number} · {label} · {context}"


def _build_supersedes_map(rows: list[dict[str, Any]]) -> dict[str, str]:
    """Map new playbook id → old playbook id (old_row.superseded_by points to the replacement)."""
    reverse: dict[str, str] = {}
    for row in rows:
        sup_by = row.get("superseded_by")
        if sup_by:
            reverse[str(sup_by)] = str(row["id"])
    return reverse


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("", response_model=PlaybooksResponse)
def list_playbooks() -> PlaybooksResponse:
    client = get_client()
    res = (
        client.table("playbook_memory")
        .select(
            "id,account_profile,signal_pattern,recommended_channel,message_template,"
            "times_used,times_succeeded,success_rate,version,superseded_by,created_at,updated_at"
        )
        .order("success_rate", desc=True)
        .limit(_MAX_PLAYBOOKS)
        .execute()
    )
    rows: list[dict[str, Any]] = res.data or []

    # Build reverse supersedes map: new_id -> old_id
    supersedes_map = _build_supersedes_map(rows)

    items: list[PlaybookItem] = []
    for i, row in enumerate(rows):
        row_id = str(row["id"])
        sup_by = row.get("superseded_by")
        replaced_at: str | None = None
        if sup_by:
            # This playbook was superseded; use updated_at as replaced_at proxy
            replaced_at = str(row.get("updated_at") or row.get("created_at") or "")

        items.append(
            PlaybookItem(
                id=row_id,
                name=_synthesize_name(row, i),
                account_profile=row.get("account_profile") or {},
                signal_pattern=row.get("signal_pattern") or {},
                recommended_channel=str(row.get("recommended_channel") or "email"),
                message_template=str(row.get("message_template") or ""),
                times_used=int(row.get("times_used") or 0),
                times_succeeded=int(row.get("times_succeeded") or 0),
                success_rate=float(row.get("success_rate") or 0.0),
                version=int(row.get("version") or 1),
                superseded_by=str(sup_by) if sup_by else None,
                supersedes=supersedes_map.get(row_id),
                replaced_at=replaced_at or None,
            )
        )

    return PlaybooksResponse(playbooks=items)


@router.get("/{playbook_id}/history", response_model=PlaybookHistoryResponse)
def get_playbook_history(playbook_id: str) -> PlaybookHistoryResponse:
    """Return a simple evolution list for a playbook (version chain)."""
    client = get_client()

    # Collect chain: start from this playbook, walk forward via superseded_by
    chain: list[dict[str, Any]] = []
    current_id: str | None = playbook_id
    visited: set[str] = set()

    while current_id and current_id not in visited:
        visited.add(current_id)
        res = (
            client.table("playbook_memory")
            .select("id,version,success_rate,times_used,created_at,updated_at,superseded_by")
            .eq("id", current_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        row = rows[0]
        chain.append(row)
        nxt = row.get("superseded_by")
        current_id = str(nxt) if nxt else None

    evolution = [
        EvolutionEntry(
            version=int(row.get("version") or 1),
            success_rate=float(row.get("success_rate") or 0.0),
            times_used=int(row.get("times_used") or 0),
            as_of=str(row.get("updated_at") or row.get("created_at") or ""),
        )
        for row in chain
    ]

    return PlaybookHistoryResponse(playbook_id=playbook_id, evolution=evolution)
