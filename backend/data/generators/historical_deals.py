"""~50 historical_deals: Claude Sonnet batch or deterministic fallback."""

from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, get_args

from backend.data.prompts.historical_deals_prompts import HISTORICAL_DEALS_SYSTEM
from backend.data.schemas import INDUSTRIES, HistoricalDealStatus, Size

_VALID_STATUS = set(get_args(HistoricalDealStatus))
_VALID_SIZE = set(get_args(Size))
_VALID_IND = set(INDUSTRIES)
from backend.shared.claude_client import ClaudeClient, sonnet_model

CACHE_NAME = "historical_deals_batch.json"


def _fallback_deals(n: int, rng: random.Random) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    rows = []
    statuses: list[HistoricalDealStatus] = ["won", "lost", "churned", "expanded"]
    for i in range(n):
        st = rng.choice(statuses)
        closed = now - timedelta(days=rng.randint(30, 900))
        ind = rng.choice(INDUSTRIES)
        size: Size = rng.choice(["startup", "smb", "mid_market", "enterprise"])
        rows.append(
            {
                "account_name": f"Cliente Histórico {i+1}",
                "industry": ind,
                "size": size,
                "arr_usd": round(rng.uniform(10_000, 220_000), 2),
                "status": st,
                "reason_given": "Precio percibido alto" if st in ("lost", "churned") else "Fit de producto sólido",
                "reason_real": "Integración compleja" if st in ("lost", "churned") else "ROI claro en 2 trimestres",
                "conversation_summary": f"Resumen sintético #{i+1}: negociación estándar en {ind}.",
                "lessons_learned": "Lección seed: alinear valor a métricas del sponsor antes de pricing.",
                "closed_at": closed.isoformat(),
            }
        )
    return rows


def generate_historical_deals(
    *,
    n: int,
    rng: random.Random,
    claude: ClaudeClient | None,
    skip_claude: bool,
    cache_dir: Path,
    model: str | None = None,
) -> list[dict[str, Any]]:
    cache_path = cache_dir / CACHE_NAME
    if cache_path.exists():
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        return _normalize(raw, rng, n)

    if skip_claude or claude is None:
        raw = _fallback_deals(n, rng)
    else:
        prompt = (
            HISTORICAL_DEALS_SYSTEM.replace("exactly N", f"exactly {n}")
            + f"\n\nGenerate exactly {n} deals as JSON array. Spanish text."
        )
        try:
            raw = claude.complete_json(
                prompt,
                model=model or sonnet_model(),
                max_tokens=8192,
                temperature=0.75,
            )
            if not isinstance(raw, list) or len(raw) < n // 2:
                raw = _fallback_deals(n, rng)
            else:
                cache_dir.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            raw = _fallback_deals(n, rng)

    return _normalize(raw, rng, n)


def _normalize(raw: Any, rng: random.Random, n: int) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raw = _fallback_deals(n, rng)
    out: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for item in raw[:n]:
        if not isinstance(item, dict):
            continue
        closed = item.get("closed_at")
        if not isinstance(closed, str):
            closed = (now - timedelta(days=rng.randint(40, 800))).isoformat()
        ind = item.get("industry", "fintech")
        if ind not in _VALID_IND:
            ind = "fintech"
        sz = item.get("size", "smb")
        if sz not in _VALID_SIZE:
            sz = "smb"
        st = item.get("status", "won")
        if st not in _VALID_STATUS:
            st = "won"
        out.append(
            {
                "id": str(uuid.uuid4()),
                "account_name": str(item.get("account_name", "Account"))[:300],
                "industry": ind,
                "size": sz,
                "arr_usd": item.get("arr_usd"),
                "status": st,
                "reason_given": item.get("reason_given"),
                "reason_real": item.get("reason_real"),
                "conversation_summary": str(item.get("conversation_summary", ""))[:8000],
                "lessons_learned": str(item.get("lessons_learned", ""))[:8000],
                "closed_at": closed,
            }
        )
    while len(out) < n:
        for item in _fallback_deals(n - len(out), rng):
            closed = item.get("closed_at")
            if not isinstance(closed, str):
                closed = (now - timedelta(days=rng.randint(40, 800))).isoformat()
            out.append({**item, "id": str(uuid.uuid4()), "closed_at": closed})
    return out[:n]
