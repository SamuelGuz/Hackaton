"""NPS responses + denormalized fields on account row."""

from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.data.prompts.nps_feedback_prompts import NPS_FEEDBACK_SYSTEM, nps_feedback_batch_prompt
from backend.data.schemas import Bucket, nps_category_from_score
from backend.shared.claude_client import ClaudeClient, haiku_model

from backend.data.generators.accounts import AccountSeed


def _score_distribution(bucket: Bucket, rng: random.Random) -> int:
    if bucket == "healthy_stable":
        return rng.choice([9, 9, 10, 10, 10])
    if bucket == "at_risk_subtle":
        return rng.choice([7, 7, 8, 8])
    if bucket == "at_risk_obvious":
        return rng.randint(0, 5)
    if bucket in ("expansion_ready", "expansion_subtle"):
        return rng.choice([8, 9, 9, 10])
    return rng.choice([8, 9, 10])


def generate_nps_for_accounts(
    seeds: list[AccountSeed],
    rng: random.Random,
    claude: ClaudeClient | None,
    skip_claude: bool,
) -> list[dict[str, Any]]:
    """Build NPS rows and denormalize latest score onto each account seed row."""
    now = datetime.now(timezone.utc)
    nps_rows: list[dict[str, Any]] = []
    feedback_items: list[dict[str, Any]] = []

    for s in seeds:
        n = rng.randint(1, 4)
        times = sorted(
            [now - timedelta(days=rng.randint(10, 360)) for _ in range(n)]
        )
        prev = None
        for t in times:
            score = _score_distribution(s.bucket, rng)
            # subtle downward trend for at_risk over time
            if s.bucket.startswith("at_risk") and prev is not None and rng.random() < 0.4:
                score = max(0, min(10, prev - rng.randint(0, 2)))
            prev = score
            cat = nps_category_from_score(score)
            nid = str(uuid.uuid4())
            row = {
                "id": nid,
                "account_id": s.id,
                "score": score,
                "category": cat,
                "feedback": None,
                "respondent_email": s.row["champion_email"],
                "respondent_role": s.row["champion_role"],
                "survey_trigger": rng.choice(
                    ["quarterly", "post_ticket", "post_qbr", "post_renewal", "manual"]
                ),
                "submitted_at": t.isoformat(),
            }
            nps_rows.append(row)
            if cat in ("detractor", "passive"):
                feedback_items.append(
                    {
                        "id": nid,
                        "score": score,
                        "category": cat,
                        "company": s.row["name"],
                    }
                )

    # Denormalize last NPS per account onto seed.row
    by_account: dict[str, list[dict[str, Any]]] = {}
    for r in nps_rows:
        by_account.setdefault(str(r["account_id"]), []).append(r)
    for aid, lst in by_account.items():
        lst.sort(key=lambda x: x["submitted_at"])
        last = lst[-1]
        seed = next(x for x in seeds if x.id == aid)
        seed.row["current_nps_score"] = last["score"]
        seed.row["current_nps_category"] = last["category"]
        seed.row["last_nps_at"] = last["submitted_at"]

    feedback_map: dict[str, str] = {}
    if feedback_items and claude and not skip_claude:
        prompt = (
            NPS_FEEDBACK_SYSTEM
            + "\n\n"
            + nps_feedback_batch_prompt(feedback_items)
        )
        try:
            raw = claude.complete_json(prompt, model=haiku_model(), max_tokens=2048, temperature=0.6)
            if isinstance(raw, list):
                for obj in raw:
                    if isinstance(obj, dict) and obj.get("id") and obj.get("feedback") is not None:
                        feedback_map[str(obj["id"])] = str(obj["feedback"])[:2000]
        except Exception:
            pass

    if feedback_map:
        for r in nps_rows:
            fid = str(r["id"])
            if fid in feedback_map:
                r["feedback"] = feedback_map[fid]
    else:
        # Short deterministic feedback
        for r in nps_rows:
            if r["category"] == "detractor":
                r["feedback"] = "Comentario sintético: varios incidentes recientes afectaron confianza."
            elif r["category"] == "passive":
                r["feedback"] = "Comentario sintético: satisfechos en parte; esperan mejoras de producto."

    return nps_rows
