"""Conversations: Claude Haiku JSON batch per account, or deterministic fallback."""

from __future__ import annotations

import json
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, get_args

from backend.data.prompts.conversations_prompts import CONVO_SYSTEM, conversations_user_prompt
from backend.data.schemas import Bucket, ConversationChannel, ConversationDirection, Sentiment
from backend.shared.claude_client import ClaudeClient, haiku_model

_log = logging.getLogger(__name__)

_VALID_CH = set(get_args(ConversationChannel))
_VALID_DIR = set(get_args(ConversationDirection))
_VALID_SENT = set(get_args(Sentiment)) | {None}


def _tone_rules(bucket: Bucket) -> str:
    if bucket == "at_risk_obvious":
        return "Several negative or very_negative threads; include escalations and frustration."
    if bucket == "at_risk_subtle":
        return "Politely concerned tone; passive-aggressive undertone ok; mostly neutral-negative."
    if bucket in ("expansion_ready", "expansion_subtle"):
        return "Positive-to-neutral; include growth signals (seats, features, roadmap questions)."
    return "Professional, collaborative; mostly neutral-positive."


def _fallback_convos(company: str, bucket: Bucket, n: int, rng: random.Random) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    channels = (
        ["email"] * 5
        + ["call_transcript"] * 3
        + ["slack"] * 2
        + ["meeting_notes"] * 1
    )
    rows = []
    for i in range(n):
        ch = rng.choice(channels)
        occurred = now - timedelta(days=rng.randint(1, 175), hours=rng.randint(0, 12))
        sent = (
            "negative"
            if bucket == "at_risk_obvious" and rng.random() < 0.55
            else (
                "neutral"
                if bucket in ("at_risk_subtle", "expansion_subtle") and rng.random() < 0.55
                else rng.choice(["positive", "neutral"])
            )
        )
        rows.append(
            {
                "channel": ch,
                "direction": rng.choice(["inbound", "outbound"]),
                "participants": [f"csm@acmesaas.io", f"champion@{company.lower().replace(' ', '')}.com"],
                "subject": f"Seguimiento {i+1}" if ch == "email" else None,
                "content": (
                    f"Resumen de conversación sintética #{i+1} para {company}. "
                    f"Tono alineado a bucket {bucket}."
                ),
                "sentiment": sent,
                "occurred_at": occurred.isoformat(),
            }
        )
    return rows


def generate_conversations_for_account(
    *,
    account_id: str,
    company_name: str,
    csm_first_name: str,
    bucket: Bucket,
    rng: random.Random,
    claude: ClaudeClient | None,
    skip_claude: bool,
    cache_path: Path | None,
    model: str | None = None,
) -> list[dict[str, Any]]:
    n = rng.randint(5, 20)

    if cache_path and cache_path.exists():
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        return _normalize_conv_rows(data, account_id)

    if skip_claude or claude is None:
        raw = _fallback_convos(company_name, bucket, n, rng)
    else:
        prompt = CONVO_SYSTEM + "\n\n" + conversations_user_prompt(
            company_name=company_name,
            csm_name=csm_first_name,
            bucket=bucket,
            n_convos=n,
            tone_rules=_tone_rules(bucket),
        )
        try:
            raw = claude.complete_json(
                prompt, model=model or haiku_model(), max_tokens=4096, temperature=0.7
            )
        except Exception as e:
            _log.warning(
                "LLM falló al generar conversaciones para %r: %s",
                company_name,
                e,
                exc_info=True,
            )
            raw = _fallback_convos(company_name, bucket, n, rng)
        if not isinstance(raw, list):
            raw = _fallback_convos(company_name, bucket, n, rng)
        if cache_path:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    return _normalize_conv_rows(raw, account_id)


def _normalize_conv_rows(raw: Any, account_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    if not isinstance(raw, list):
        return []
    for item in raw:
        if not isinstance(item, dict):
            continue
        parts = item.get("participants")
        if isinstance(parts, str):
            parts = [parts]
        if not isinstance(parts, list) or not parts:
            parts = ["csm@acmesaas.io", "customer@example.com"]
        ch = item.get("channel", "email")
        if ch not in _VALID_CH:
            ch = "email"
        dr = item.get("direction", "outbound")
        if dr not in _VALID_DIR:
            dr = "outbound"
        sent = item.get("sentiment")
        if sent not in _VALID_SENT:
            sent = "neutral"
        occ = item.get("occurred_at")
        if not isinstance(occ, str):
            occ = (now - timedelta(days=random.randint(1, 175))).isoformat()
        out.append(
            {
                "id": str(uuid.uuid4()),
                "account_id": account_id,
                "channel": ch,
                "direction": dr,
                "participants": [str(p) for p in parts],
                "subject": item.get("subject"),
                "content": str(item.get("content", "(vacío)"))[:12000],
                "sentiment": sent,
                "occurred_at": occ,
            }
        )
    return out
