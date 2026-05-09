"""account_health_history + account_health_snapshot seed."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.data.generators.accounts import AccountSeed
from backend.data.schemas import Bucket


def _base_scores(bucket: Bucket, rng: random.Random) -> tuple[int, int, str]:
    """Returns (churn_risk, expansion_score, health_status)."""
    if bucket == "at_risk_obvious":
        return rng.randint(62, 88), rng.randint(10, 35), rng.choice(["critical", "at_risk"])
    if bucket == "at_risk_subtle":
        return rng.randint(38, 62), rng.randint(22, 45), "at_risk"
    if bucket == "expansion_ready":
        return rng.randint(12, 32), rng.randint(68, 92), rng.choice(["healthy", "expanding"])
    if bucket == "expansion_subtle":
        return rng.randint(18, 40), rng.randint(52, 78), rng.choice(["stable", "healthy", "expanding"])
    # healthy_stable
    return rng.randint(12, 35), rng.randint(38, 58), rng.choice(["stable", "healthy"])


def _health_status_from_scores(churn: int, exp: int, rng: random.Random) -> str:
    if churn >= 70:
        return "critical" if churn >= 78 else "at_risk"
    if exp >= 72 and churn < 45:
        return "expanding"
    if churn >= 45:
        return "at_risk"
    if exp >= 60:
        return "healthy"
    return rng.choice(["stable", "healthy"])


def _mc_walk_params(bucket: Bucket) -> tuple[float, float, float]:
    """(churn_drift, expansion_drift, gaussian_sigma) per Monte Carlo plan."""
    if bucket == "at_risk_obvious":
        return 4.5, -1.0, 4.0
    if bucket == "at_risk_subtle":
        return 2.0, -0.5, 3.0
    if bucket == "expansion_ready":
        return -1.0, 4.5, 4.0
    if bucket == "expansion_subtle":
        return -0.5, 2.5, 3.0
    return 0.0, 0.0, 2.5


def _mc_initial_scores(bucket: Bucket, rng: random.Random) -> tuple[int, int]:
    """Oldest point in the health series (random walk start)."""
    if bucket == "at_risk_obvious":
        return rng.randint(18, 42), rng.randint(12, 32)
    if bucket == "at_risk_subtle":
        return rng.randint(24, 48), rng.randint(18, 38)
    if bucket in ("expansion_ready", "expansion_subtle"):
        return rng.randint(14, 36), rng.randint(34, 56)
    return rng.randint(16, 34), rng.randint(32, 54)


def build_health_history_and_snapshot(
    seed: AccountSeed,
    rng: random.Random,
    *,
    version: str = "seed-synthetic-v1",
    monte_carlo: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    churn_end, exp_end, _ = _base_scores(seed.bucket, rng)
    n_points = rng.randint(3, 8)
    now = datetime.now(timezone.utc)
    step_days = max(10, 90 // max(n_points - 1, 1))

    churn_vals: list[int] = []
    exp_vals: list[int] = []
    status_vals: list[str] = []

    if monte_carlo:
        d_churn, d_exp, sigma = _mc_walk_params(seed.bucket)
        c0, e0 = _mc_initial_scores(seed.bucket, rng)
        churn_vals.append(c0)
        exp_vals.append(e0)
        c, e = float(c0), float(e0)
        for _ in range(n_points - 1):
            c = max(5, min(95, c + d_churn + rng.gauss(0, sigma)))
            e = max(5, min(95, e + d_exp + rng.gauss(0, sigma)))
            churn_vals.append(int(round(c)))
            exp_vals.append(int(round(e)))
        status_vals = [_health_status_from_scores(churn_vals[i], exp_vals[i], rng) for i in range(n_points)]
    else:
        for i in range(n_points):
            t = i / max(n_points - 1, 1)
            if seed.bucket.startswith("at_risk"):
                start_c = rng.randint(22, 48)
                end_c = min(93, max(start_c + 18, churn_end))
                churn = int(start_c + t * (end_c - start_c))
                exp_start = rng.randint(15, 42)
                exp = int(exp_start + t * (exp_end - exp_start) * 0.35)
            elif seed.bucket.startswith("expansion"):
                churn_start = rng.randint(15, 38)
                churn = int(churn_start + t * (churn_end - churn_start) * 0.4)
                start_e = rng.randint(38, 58)
                end_e = min(92, max(start_e + 20, exp_end))
                exp = int(start_e + t * (end_e - start_e))
            else:
                churn = int(churn_end + rng.randint(-6, 6) * (0.5 - abs(t - 0.5)))
                exp = int(exp_end + rng.randint(-6, 6) * (0.5 - abs(t - 0.5)))
            churn = max(5, min(95, churn))
            exp = max(5, min(95, exp))
            churn_vals.append(churn)
            exp_vals.append(exp)
            status_vals.append(_health_status_from_scores(churn, exp, rng))

    history: list[dict[str, Any]] = []
    for i in range(n_points):
        computed_at = now - timedelta(days=step_days * (n_points - 1 - i))
        churn = churn_vals[i]
        expansion = exp_vals[i]
        health_status = status_vals[i]
        signals: list[dict[str, Any]] = [
            {"signal": "login_trend", "direction": "down" if seed.bucket.startswith("at_risk") else "flat"},
            {"signal": "ticket_sentiment", "value": "mixed" if seed.bucket == "at_risk_subtle" else "ok"},
        ]
        if seed.is_demo_trap_churn:
            signals.append({"signal": "demo_trap", "kind": "subtle_churn"})
        if seed.is_demo_trap_expansion:
            signals.append({"signal": "demo_trap", "kind": "subtle_expansion"})

        history.append(
            {
                "id": str(uuid.uuid4()),
                "account_id": seed.id,
                "churn_risk_score": churn,
                "expansion_score": expansion,
                "health_status": health_status,
                "top_signals": signals,
                "predicted_churn_reason": (
                    "Caída de adopción y tickets sin resolver"
                    if health_status in ("at_risk", "critical")
                    else None
                ),
                "crystal_ball_confidence": round(rng.uniform(0.72, 0.91), 2),
                "computed_at": computed_at.isoformat(),
                "computed_by_version": version + ("+mc" if monte_carlo else ""),
            }
        )

    last = history[-1]
    snap_top = list(last["top_signals"])
    if seed.is_demo_trap_churn:
        snap_top.append({"demo_trap": "subtle_churn", "note": "Señales fáciles de pasar por alto"})
    if seed.is_demo_trap_expansion:
        snap_top.append({"demo_trap": "subtle_expansion", "note": "Upsell no obvio desde ARR"})

    snapshot: dict[str, Any] = {
        "account_id": seed.id,
        "churn_risk_score": last["churn_risk_score"],
        "top_signals": snap_top,
        "predicted_churn_reason": last["predicted_churn_reason"],
        "crystal_ball_confidence": last["crystal_ball_confidence"],
        "crystal_ball_reasoning": (
            "Modelo seed: riesgo alineado a señales de uso, tickets y NPS reciente."
            if last["churn_risk_score"] >= 45
            else "Modelo seed: riesgo moderado; monitorear adopción y QBR."
        ),
        "expansion_score": last["expansion_score"],
        "ready_to_expand": seed.bucket in ("expansion_ready", "expansion_subtle") and last["expansion_score"] >= 65,
        "recommended_plan": (
            "enterprise" if seed.bucket == "expansion_ready" and last["expansion_score"] >= 70 else None
        ),
        "expansion_reasoning": (
            "Uso y conversaciones sugieren espacio para upsell de seats y módulos avanzados."
            if seed.bucket.startswith("expansion")
            else None
        ),
        "suggested_upsell_message": (
            "Propuesta seed: revisión de límites de seats y trial de módulo analytics."
            if seed.bucket.startswith("expansion")
            else None
        ),
        "health_status": last["health_status"],
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "computed_by_version": last["computed_by_version"],
    }
    return history, snapshot
