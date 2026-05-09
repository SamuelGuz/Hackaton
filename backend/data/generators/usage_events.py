"""Deterministic usage_events (CONTRACTS.md §1 usage_events + §4.2)."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.data.schemas import Bucket, UsageEventType


FEATURE_NAMES = (
    "dashboards",
    "export_csv",
    "api_webhooks",
    "billing_portal",
    "sso_saml",
    "audit_log",
    "workflows",
    "saved_views",
)


def generate_usage_events(
    account_id: str,
    bucket: Bucket,
    *,
    rng: random.Random,
    count: int,
    window_days: int = 180,
) -> list[dict[str, Any]]:
    """Generate `count` events spread over `window_days`, with bucket-shaped activity."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=window_days)
    rows: list[dict[str, Any]] = []

    # Weekly multiplier curve (26 weeks ~= 180d)
    weeks = max(1, window_days // 7)

    def week_multiplier(week_idx: int) -> float:
        if bucket.startswith("at_risk") and week_idx >= weeks - 8:
            return max(0.15, 1.0 - (week_idx - (weeks - 8)) * 0.11)
        if bucket.startswith("expansion"):
            return 1.0 + week_idx * 0.025
        return 1.0

    # Distribute event timestamps across window
    for _ in range(count):
        # pick week then random day in week
        w = rng.randint(0, weeks - 1)
        mult = week_multiplier(w)
        week_start = start + timedelta(days=7 * w)
        occurred = week_start + timedelta(
            hours=rng.randint(0, 167),
            minutes=rng.randint(0, 59),
        )
        if occurred > now:
            occurred = now - timedelta(minutes=rng.randint(1, 120))

        r = rng.random()
        if r < 0.68:
            et: UsageEventType = "login"
            feature_name = None
            meta: dict[str, Any] = {"session_minutes": rng.randint(5, 95)}
        elif r < 0.88:
            et = "feature_used"
            feature_name = rng.choice(FEATURE_NAMES)
            meta = {"duration_sec": rng.randint(12, 900)}
        elif r < 0.93:
            et = "report_generated"
            feature_name = None
            meta = {"report_type": rng.choice(["usage", "billing", "adoption"])}
        elif r < 0.96:
            et = rng.choice(["api_call", "integration_connected", "integration_disconnected"])
            feature_name = None
            meta = {"path": "/v1/metrics"}
        else:
            et = rng.choice(["user_invited", "user_removed", "admin_action"])
            feature_name = None
            meta = {"actor": "admin@client.com"}

        # Scale login probability down when multiplier low
        if et == "login" and mult < 0.35 and rng.random() < 0.35:
            et = "feature_used"
            feature_name = rng.choice(FEATURE_NAMES)
            meta = {"duration_sec": rng.randint(30, 400)}

        rows.append(
            {
                "id": str(uuid.uuid4()),
                "account_id": account_id,
                "event_type": et,
                "feature_name": feature_name,
                "user_email": f"user{rng.randint(1, 80)}@client.example.com",
                "occurred_at": occurred.isoformat(),
                "metadata": meta,
            }
        )

    rows.sort(key=lambda x: x["occurred_at"])
    return rows
