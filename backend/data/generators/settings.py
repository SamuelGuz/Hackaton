"""system_settings seed (CONTRACTS.md §1 / §4.4)."""

from __future__ import annotations

from typing import Any


def build_system_settings_rows() -> list[dict[str, Any]]:
    return [
        {
            "key": "auto_approval_enabled",
            "value": False,
            "description": "Si TRUE, las intervenciones con requires_approval=true se aprueban automáticamente sin esperar a un humano.",
        },
        {
            "key": "auto_approval_max_arr_usd",
            "value": 25000,
            "description": "Cuando auto_approval_enabled=true, solo aprueba auto si arr_usd de la cuenta <= este valor.",
        },
        {
            "key": "auto_approval_min_confidence",
            "value": 0.80,
            "description": "Cuando auto_approval_enabled=true, solo aprueba auto si confidence_score >= este valor.",
        },
    ]
