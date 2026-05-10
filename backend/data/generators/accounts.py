"""Generate accounts with bucket distribution (CONTRACTS.md §4.1)."""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from faker import Faker

from backend.data.generators.csm_team import csm_by_role
from backend.data.schemas import INDUSTRIES, Bucket, Industry, Plan, Size


@dataclass
class AccountSeed:
    """In-memory account + generation metadata (bucket is not persisted)."""

    id: str
    bucket: Bucket
    is_demo_trap_churn: bool = False
    is_demo_trap_expansion: bool = False
    row: dict[str, Any] = field(default_factory=dict)


def _bucket_distribution(n: int) -> list[Bucket]:
    """40/20/15/15/10 split; exact counts sum to n (largest-remainder)."""
    specs: list[tuple[Bucket, float]] = [
        ("healthy_stable", 0.40),
        ("at_risk_subtle", 0.20),
        ("at_risk_obvious", 0.15),
        ("expansion_ready", 0.15),
        ("expansion_subtle", 0.10),
    ]
    exact = [(b, r * n) for b, r in specs]
    floors: dict[Bucket, int] = {b: int(x) for b, x in exact}
    remainder = n - sum(floors.values())
    fracs = sorted(((b, x - int(x)) for b, x in exact), key=lambda t: (-t[1], t[0]))
    i = 0
    while remainder > 0:
        b = fracs[i % len(fracs)][0]
        floors[b] += 1
        remainder -= 1
        i += 1
    order: list[Bucket] = []
    for b, _ in specs:
        order.extend([b] * floors[b])
    rng = random.Random(42)
    rng.shuffle(order)
    return order


def _lognormal_arr(rng: random.Random, mean_usd: float, sigma: float) -> float:
    """Sample ARR (USD) from log-normal; mean_usd is the geometric mean."""
    mu = math.log(max(mean_usd, 1.0))
    return round(math.exp(mu + rng.gauss(0, sigma)), 2)


def _pick_plan_size_arr_for_bucket(
    bucket: Bucket, rng: random.Random, *, monte_carlo: bool = False
) -> tuple[Plan, Size, float]:
    if bucket in ("expansion_ready", "expansion_subtle"):
        plan: Plan = rng.choice(["growth", "business", "enterprise"])
        size: Size = rng.choice(["smb", "mid_market", "enterprise"])
        if monte_carlo:
            base = _lognormal_arr(rng, 80_000, 0.55)
            if size == "enterprise":
                base = max(base, _lognormal_arr(rng, 140_000, 0.42))
        else:
            base = rng.uniform(40_000, 280_000) if size == "enterprise" else rng.uniform(15_000, 90_000)
            base = round(base, 2)
        return plan, size, float(max(5_000, min(500_000, base)))
    if bucket == "at_risk_obvious":
        plan = rng.choice(["starter", "growth", "business"])
        size = rng.choice(["startup", "smb", "mid_market"])
        if monte_carlo:
            base = _lognormal_arr(rng, 25_000, 0.65)
        else:
            base = round(rng.uniform(8_000, 75_000), 2)
        return plan, size, float(max(5_000, min(500_000, base)))
    if bucket in ("at_risk_subtle",):
        plan = rng.choice(["growth", "business"])
        size = rng.choice(["smb", "mid_market", "enterprise"])
        if monte_carlo:
            base = _lognormal_arr(rng, 45_000, 0.60)
        else:
            base = round(rng.uniform(20_000, 120_000), 2)
        return plan, size, float(max(5_000, min(500_000, base)))
    # healthy_stable
    plan = rng.choice(["starter", "growth", "business", "enterprise"])
    size = rng.choice(["startup", "smb", "mid_market", "enterprise"])
    if monte_carlo:
        base = _lognormal_arr(rng, 55_000, 0.58)
    else:
        base = round(rng.uniform(12_000, 200_000), 2)
    return plan, size, float(max(5_000, min(500_000, base)))


def _seats_for_bucket(
    bucket: Bucket, plan: Plan, rng: random.Random, *, monte_carlo: bool = False
) -> tuple[int, int]:
    base_plan = {"starter": 25, "growth": 80, "business": 200, "enterprise": 800}[plan]
    if monte_carlo:
        purchased = int(base_plan * max(0.45, min(1.65, rng.gauss(1.0, 0.15))))
    else:
        purchased = int(base_plan * rng.uniform(0.6, 1.4))
    purchased = max(5, purchased)

    if monte_carlo:
        if bucket in ("expansion_ready", "expansion_subtle"):
            mu_r, sig_r = 0.93, 0.04
        elif bucket in ("at_risk_obvious",):
            mu_r, sig_r = 0.40, 0.08
        elif bucket in ("at_risk_subtle",):
            mu_r, sig_r = 0.58, 0.08
        else:
            mu_r, sig_r = 0.70, 0.10
        ratio = max(0.05, min(0.99, rng.gauss(mu_r, sig_r)))
        active = max(1, min(purchased, round(purchased * ratio)))
    else:
        if bucket in ("expansion_ready", "expansion_subtle"):
            active = int(purchased * rng.uniform(0.88, 0.99))
        elif bucket in ("at_risk_obvious",):
            active = int(purchased * rng.uniform(0.25, 0.55))
        elif bucket in ("at_risk_subtle",):
            active = int(purchased * rng.uniform(0.45, 0.72))
        else:
            active = int(purchased * rng.uniform(0.55, 0.85))
        active = max(1, min(active, purchased))
    return purchased, active


def _champion_phone_e164(geography: str, rng: random.Random) -> str:
    """Synthetic E.164 mobile loosely aligned with geography (demo data)."""
    if geography == "us":
        return "+1" + str(rng.randint(2_000_000_000, 9_999_999_999))
    prefix = {"latam": "+52", "eu": "+34", "apac": "+61"}.get(geography, "+52")
    return prefix + str(rng.randint(1_000_000_000, 9_999_999_999))


def _assign_csm_id(
    *,
    size: Size,
    arr_usd: float,
    role_map: dict[str, list[str]],
    rng: random.Random,
    idx: int,
    head_quota: dict[str, int],
) -> str:
    if size == "enterprise" or arr_usd > 100_000:
        pool = role_map.get("senior_csm", []) + role_map.get("csm_manager", [])
        return rng.choice(pool)
    # head_of_cs: only first few accounts (strategic)
    h = role_map.get("head_of_cs", [])
    if h and head_quota["remaining"] > 0 and rng.random() < 0.04:
        head_quota["remaining"] -= 1
        return h[0]
    # Round-robin between the two csms
    csms = role_map.get("csm", [])
    if not csms:
        raise RuntimeError("No csm role rows")
    return csms[idx % len(csms)]


def build_account_seeds(
    n: int,
    csm_rows: list[dict[str, Any]],
    *,
    faker_seed: int = 42,
    monte_carlo: bool = False,
) -> list[AccountSeed]:
    rng = random.Random(faker_seed)
    try:
        Faker.seed(faker_seed)  # type: ignore[attr-defined]
    except AttributeError:
        pass
    fake = Faker("es_MX")
    try:
        fake.seed_instance(faker_seed)  # type: ignore[attr-defined]
    except AttributeError:
        pass
    buckets = _bucket_distribution(n)
    role_map = csm_by_role(csm_rows)
    head_quota = {"remaining": 8}

    subtle_indices = [i for i, b in enumerate(buckets) if b == "at_risk_subtle"]
    exp_sub_indices = [i for i, b in enumerate(buckets) if b == "expansion_subtle"]
    trap_churn = set(subtle_indices[:3])
    trap_exp = set(exp_sub_indices[:2])

    seeds: list[AccountSeed] = []
    for i, bucket in enumerate(buckets):
        aid = str(uuid.uuid4())
        industry: Industry = rng.choice(INDUSTRIES)  # type: ignore[assignment]
        geography = rng.choice(["latam", "us", "eu", "apac"])
        plan, size, arr_usd = _pick_plan_size_arr_for_bucket(bucket, rng, monte_carlo=monte_carlo)
        seats_purchased, seats_active = _seats_for_bucket(
            bucket, plan, rng, monte_carlo=monte_carlo
        )
        csm_id = _assign_csm_id(
            size=size,
            arr_usd=arr_usd,
            role_map=role_map,
            rng=rng,
            idx=i,
            head_quota=head_quota,
        )

        now = datetime.now(timezone.utc)
        signup = now - timedelta(days=rng.randint(60, 720))
        renewal = signup + timedelta(days=rng.randint(300, 420))
        account_number = f"ACC-{signup.year}-{i + 1:05d}"

        champion_changed = False
        if bucket == "at_risk_obvious" and rng.random() < 0.45:
            champion_changed = True
        if i in trap_churn and rng.random() < 0.5:
            champion_changed = True

        last_qbr = None
        if bucket.startswith("at_risk") and rng.random() < 0.7:
            last_qbr = now - timedelta(days=rng.randint(85, 200))
        elif rng.random() < 0.6:
            last_qbr = now - timedelta(days=rng.randint(20, 75))

        compact_uuid = aid.replace("-", "").upper()
        row: dict[str, Any] = {
            "id": aid,
            "account_number": f"ACC-{signup.year}-{compact_uuid[:10]}",
            "name": fake.company(),
            "industry": industry,
            "size": size,
            "geography": geography,
            "plan": plan,
            "arr_usd": arr_usd,
            "seats_purchased": seats_purchased,
            "seats_active": seats_active,
            "signup_date": signup.isoformat(),
            "contract_renewal_date": renewal.isoformat(),
            "champion_name": fake.name(),
            "champion_email": fake.company_email(),
            "champion_role": rng.choice(["CFO", "VP Operations", "Head of IT", "Director Comercial", "COO"]),
            "champion_phone": _champion_phone_e164(geography, rng),
            "champion_changed_recently": champion_changed,
            "csm_id": csm_id,
            "last_qbr_date": last_qbr.isoformat() if last_qbr else None,
            # NPS denorm filled later by nps_responses generator
            "current_nps_score": None,
            "current_nps_category": None,
            "last_nps_at": None,
        }

        seeds.append(
            AccountSeed(
                id=aid,
                bucket=bucket,
                is_demo_trap_churn=i in trap_churn,
                is_demo_trap_expansion=i in trap_exp,
                row=row,
            )
        )

    # Assign ~7 strategic accounts to head_of_cs (CONTRACTS §4.0)
    head_id = role_map.get("head_of_cs", [None])[0]
    if head_id:
        strategic = [
            s
            for s in seeds
            if s.row["size"] == "enterprise" or float(s.row["arr_usd"]) >= 150_000
        ]
        rng.shuffle(strategic)
        for s in strategic[:7]:
            s.row["csm_id"] = head_id

    return seeds
