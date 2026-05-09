"""Tickets: Claude Haiku JSON batch per account, or deterministic fallback."""

from __future__ import annotations

import json
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, get_args

from backend.data.prompts.tickets_prompts import TICKETS_SYSTEM, tickets_user_prompt
from backend.data.schemas import Bucket, Sentiment, TicketPriority, TicketStatus
from backend.shared.claude_client import ClaudeClient, haiku_model

_log = logging.getLogger(__name__)

_VALID_PRI = set(get_args(TicketPriority))
_VALID_STAT = set(get_args(TicketStatus))
_VALID_SENT = set(get_args(Sentiment)) | {None}


def _rules_for_bucket(bucket: Bucket) -> str:
    if bucket == "at_risk_obvious":
        return (
            "Majority sentiment negative or very_negative. "
            "At least one ticket open or escalated. Some high/critical priority."
        )
    if bucket == "at_risk_subtle":
        return "Mix neutral and negative sentiment. Mostly resolved; 0-1 may stay in_progress."
    if bucket == "healthy_stable":
        return "All resolved. Sentiments neutral or positive. Low/medium priority only."
    if bucket in ("expansion_ready", "expansion_subtle"):
        return "Mostly resolved neutral/positive; can include 1 feature request tone neutral-positive."
    return "Resolved or in_progress with neutral sentiment."


def _fallback_tickets(account_name: str, bucket: Bucket, n: int, rng: random.Random) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    rows: list[dict[str, Any]] = []
    templates = {
        "at_risk_obvious": [
            ("Integración fallando con ERP", "negative", "high", "open"),
            ("Facturación incorrecta", "very_negative", "critical", "escalated"),
        ],
        "at_risk_subtle": [
            ("Lentitud en reportes mensuales", "neutral", "medium", "resolved"),
            ("Duda sobre permisos de rol", "neutral", "low", "resolved"),
        ],
        "healthy_stable": [
            ("Solicitud de exportación CSV", "neutral", "low", "resolved"),
        ],
        "expansion_ready": [
            ("Consulta por plan enterprise", "positive", "medium", "resolved"),
        ],
        "expansion_subtle": [
            ("Pregunta por API rate limits", "neutral", "low", "resolved"),
        ],
    }
    pool = templates.get(bucket, templates["healthy_stable"])
    for i in range(n):
        subj, sent, pri, stat = rng.choice(pool)
        opened = now - timedelta(days=rng.randint(5, 170))
        resolved = None
        if stat == "resolved":
            resolved = opened + timedelta(hours=rng.randint(2, 96))
        rows.append(
            {
                "subject": subj + (f" #{i+1}" if n > 1 else ""),
                "description": f"Cliente {account_name}: detalle sintético del ticket para demo.",
                "priority": pri,
                "status": stat,
                "sentiment": sent,
                "opened_at": opened.isoformat(),
                "resolved_at": resolved.isoformat() if resolved else None,
                "first_response_hours": float(rng.randint(1, 36)) if stat != "open" else None,
            }
        )
    return rows


def generate_tickets_for_account(
    *,
    account_id: str,
    company_name: str,
    industry: str,
    bucket: Bucket,
    rng: random.Random,
    claude: ClaudeClient | None,
    skip_claude: bool,
    cache_path: Path | None,
    model: str | None = None,
) -> list[dict[str, Any]]:
    n = rng.randint(0, 5)
    if n == 0:
        return []

    if cache_path and cache_path.exists():
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        return _normalize_ticket_rows(data, account_id, rng)

    if skip_claude or claude is None:
        raw = _fallback_tickets(company_name, bucket, n, rng)
    else:
        prompt = TICKETS_SYSTEM + "\n\n" + tickets_user_prompt(
            company_name=company_name,
            industry=industry,
            bucket=bucket,
            n_tickets=n,
            sentiment_rules=_rules_for_bucket(bucket),
        )
        try:
            raw = claude.complete_json(
                prompt, model=model or haiku_model(), max_tokens=2048, temperature=0.65
            )
        except Exception as e:
            _log.warning(
                "LLM falló al generar tickets para %r: %s",
                company_name,
                e,
                exc_info=True,
            )
            raw = _fallback_tickets(company_name, bucket, n, rng)
        if not isinstance(raw, list):
            raw = _fallback_tickets(company_name, bucket, n, rng)
        if cache_path:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    return _normalize_ticket_rows(raw, account_id, rng)


def _normalize_ticket_rows(raw: Any, account_id: str, rng: random.Random) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        opened = item.get("opened_at")
        if not isinstance(opened, str):
            opened = (now - timedelta(days=rng.randint(1, 120))).isoformat()
        pri = item.get("priority", "medium")
        if pri not in _VALID_PRI:
            pri = "medium"
        stat = item.get("status", "open")
        if stat not in _VALID_STAT:
            stat = "open"
        sent = item.get("sentiment")
        if sent not in _VALID_SENT:
            sent = "neutral"
        out.append(
            {
                "id": str(uuid.uuid4()),
                "account_id": account_id,
                "subject": str(item.get("subject", "Soporte"))[:500],
                "description": str(item.get("description", "Sin detalle"))[:8000],
                "priority": pri,
                "status": stat,
                "sentiment": sent,
                "opened_at": opened,
                "resolved_at": item.get("resolved_at"),
                "first_response_hours": item.get("first_response_hours"),
            }
        )
    return out
