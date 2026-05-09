"""Deterministic usage_events (CONTRACTS.md §1 usage_events + §4.2)."""

from __future__ import annotations

import math
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


def _poisson(rng: random.Random, lam: float) -> int:
    """Knuth's algorithm for Poisson sampling (exact, stdlib-only)."""
    if lam <= 0:
        return 0
    l_val = math.exp(-lam)
    k = 0
    p = 1.0
    while p > l_val:
        k += 1
        p *= rng.random()
    return k - 1


def _bucket_base_lambda(bucket: Bucket) -> float:
    if bucket.startswith("at_risk"):
        return 6.0
    if bucket.startswith("expansion"):
        return 5.0
    return 5.0


def _append_event_row(
    rows: list[dict[str, Any]],
    *,
    account_id: str,
    rng: random.Random,
    occurred: datetime,
    now: datetime,
    mult: float,
) -> None:
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


def generate_usage_events(
    account_id: str,
    bucket: Bucket,
    *,
    rng: random.Random,
    count: int,
    window_days: int = 180,
    monte_carlo: bool = False,
) -> list[dict[str, Any]]:
    """Generate events over `window_days`. If monte_carlo, weekly counts ~ Poisson with expected total ~ count."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=window_days)
    rows: list[dict[str, Any]] = []
    weeks = max(1, window_days // 7)

    def week_multiplier(week_idx: int) -> float:
        if bucket.startswith("at_risk") and week_idx >= weeks - 8:
            return max(0.15, 1.0 - (week_idx - (weeks - 8)) * 0.11)
        if bucket.startswith("expansion"):
            return 1.0 + week_idx * 0.025
        return 1.0

    if monte_carlo:
        base = _bucket_base_lambda(bucket)
        raw_l: list[float] = []
        for w in range(weeks):
            m = week_multiplier(w)
            if bucket.startswith("at_risk") and w >= weeks - 8:
                m *= max(0.35, 1.0 - 0.12 * (w - (weeks - 8)))
            elif bucket.startswith("expansion"):
                m *= 1.0 + 0.06 * w
            raw_l.append(base * m)
        s = sum(raw_l)
        scale = (count / s) if s > 0 else 1.0
        for w in range(weeks):
            lam = max(0.25, raw_l[w] * scale)
            n_e = _poisson(rng, lam)
            week_start = start + timedelta(days=7 * w)
            mult = week_multiplier(w)
            for _ in range(n_e):
                occurred = week_start + timedelta(
                    hours=rng.randint(0, 167),
                    minutes=rng.randint(0, 59),
                )
                _append_event_row(rows, account_id=account_id, rng=rng, occurred=occurred, now=now, mult=mult)
        rows.sort(key=lambda x: x["occurred_at"])
        return rows

    for _ in range(count):
        w = rng.randint(0, weeks - 1)
        mult = week_multiplier(w)
        week_start = start + timedelta(days=7 * w)
        occurred = week_start + timedelta(
            hours=rng.randint(0, 167),
            minutes=rng.randint(0, 59),
        )
        _append_event_row(rows, account_id=account_id, rng=rng, occurred=occurred, now=now, mult=mult)

    rows.sort(key=lambda x: x["occurred_at"])
    return rows
