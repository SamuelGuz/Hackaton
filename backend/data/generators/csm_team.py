"""Deterministic CSM team seed (CONTRACTS.md §4.0)."""

from __future__ import annotations

import uuid
from typing import Any


def build_csm_team_rows() -> list[dict[str, Any]]:
    """Five CSMs with fixed UUIDs for reproducible seeds."""
    rows = [
        {
            "id": str(uuid.UUID("11111111-1111-1111-1111-111111111101")),
            "name": "Carlos López",
            "email": "carlos@acmesaas.io",
            "slack_handle": "@carlos",
            "slack_user_id": None,
            "phone": "+573001234501",
            "role": "senior_csm",
            "active": True,
        },
        {
            "id": str(uuid.UUID("11111111-1111-1111-1111-111111111102")),
            "name": "Ana Restrepo",
            "email": "ana@acmesaas.io",
            "slack_handle": "@ana",
            "slack_user_id": None,
            "phone": "+573001234502",
            "role": "csm",
            "active": True,
        },
        {
            "id": str(uuid.UUID("11111111-1111-1111-1111-111111111103")),
            "name": "Diego Martínez",
            "email": "diego@acmesaas.io",
            "slack_handle": "@diego",
            "slack_user_id": None,
            "phone": "+573001234503",
            "role": "csm",
            "active": True,
        },
        {
            "id": str(uuid.UUID("11111111-1111-1111-1111-111111111104")),
            "name": "Laura Gómez",
            "email": "laura@acmesaas.io",
            "slack_handle": "@laura",
            "slack_user_id": None,
            "phone": "+573001234504",
            "role": "csm_manager",
            "active": True,
        },
        {
            "id": str(uuid.UUID("11111111-1111-1111-1111-111111111105")),
            "name": "Sofía Hernández",
            "email": "sofia@acmesaas.io",
            "slack_handle": "@sofia",
            "slack_user_id": None,
            "phone": "+573001234505",
            "role": "head_of_cs",
            "active": True,
        },
    ]
    return rows


def csm_by_role(rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for r in rows:
        role = str(r["role"])
        out.setdefault(role, []).append(str(r["id"]))
    return out
