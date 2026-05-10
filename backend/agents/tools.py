"""Crystal Ball agent tools.

Pure-Python tool implementations that the Crystal Ball agent (Claude Sonnet)
calls during its reasoning loop. Each tool reads from Supabase except
`analyze_sentiment_batch` and `summarize_text`, which call Haiku via
`shared.claude_client`.

Also exports:
- `TOOLS_SPEC`: OpenAI tools schema (list of {type:"function", function:{name, description, parameters}})
- `TOOL_DISPATCH`: name -> python callable, excluding the `submit_final_analysis`
  sentinel tool (which terminates the agent loop).
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from backend.shared.openai_client import complete_simple
from backend.shared.supabase_client import get_supabase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Account / usage / tickets / conversations
# ---------------------------------------------------------------------------

def get_account_details(account_id: str) -> dict:
    """Return the full accounts row for `account_id` (without health block)."""
    sb = get_supabase()
    res = sb.table("accounts").select("*").eq("id", account_id).limit(1).execute()
    rows = res.data or []
    if not rows:
        return {"error": f"account_not_found: {account_id}"}
    return rows[0]


def get_usage_events(
    account_id: str,
    since_days_ago: int = 90,
    event_types: list[str] | None = None,
    aggregate_by: str = "week",
) -> dict:
    """Return usage events (raw or aggregated) for `account_id`.

    aggregate_by:
      - "none": {"events": [...]}
      - "day" / "week": {"aggregation": "day"|"week",
                          "buckets": {bucket_iso: {event_type: count}}}
    """
    sb = get_supabase()
    since = datetime.now(timezone.utc) - timedelta(days=since_days_ago)
    query = (
        sb.table("usage_events")
        .select("*")
        .eq("account_id", account_id)
        .gte("occurred_at", since.isoformat())
        .order("occurred_at", desc=False)
    )
    if event_types:
        query = query.in_("event_type", event_types)
    res = query.execute()
    events: list[dict] = res.data or []

    if aggregate_by == "none":
        return {"account_id": account_id, "events": events, "count": len(events)}

    if aggregate_by not in ("day", "week"):
        return {"error": f"invalid aggregate_by: {aggregate_by}"}

    buckets: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for ev in events:
        ts_raw = ev.get("occurred_at")
        if not ts_raw:
            continue
        # supabase returns iso strings; normalize Z suffix
        ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        if aggregate_by == "day":
            bucket_key = ts.date().isoformat()
        else:  # week — ISO Monday
            monday = ts.date() - timedelta(days=ts.weekday())
            bucket_key = monday.isoformat()
        buckets[bucket_key][ev.get("event_type", "unknown")] += 1

    # Convert nested defaultdicts to plain dicts for clean JSON
    return {
        "account_id": account_id,
        "aggregation": aggregate_by,
        "buckets": {k: dict(v) for k, v in sorted(buckets.items())},
        "total_events": len(events),
    }


def get_tickets(
    account_id: str,
    status_filter: str = "all",
    limit: int = 20,
) -> list[dict]:
    """Return up to `limit` tickets for the account, newest first."""
    sb = get_supabase()
    query = (
        sb.table("tickets")
        .select("*")
        .eq("account_id", account_id)
        .order("opened_at", desc=True)
        .limit(limit)
    )
    if status_filter == "open":
        query = query.eq("status", "open")
    elif status_filter == "unresolved":
        query = query.in_("status", ["open", "in_progress", "escalated"])
    elif status_filter != "all":
        return [{"error": f"invalid status_filter: {status_filter}"}]
    res = query.execute()
    return res.data or []


def get_conversations(
    account_id: str,
    last_n: int = 10,
    channel_filter: str = "all",
) -> list[dict]:
    """Return the most recent `last_n` conversations for the account."""
    sb = get_supabase()
    query = (
        sb.table("conversations")
        .select("*")
        .eq("account_id", account_id)
        .order("occurred_at", desc=True)
        .limit(last_n)
    )
    if channel_filter != "all":
        if channel_filter not in ("email", "call_transcript", "slack", "meeting_notes"):
            return [{"error": f"invalid channel_filter: {channel_filter}"}]
        query = query.eq("channel", channel_filter)
    res = query.execute()
    return res.data or []


# ---------------------------------------------------------------------------
# Haiku-backed utilities
# ---------------------------------------------------------------------------

_SENTIMENT_VALUES = {"positive", "neutral", "negative", "very_negative"}


def analyze_sentiment_batch(texts: list[str], context: str = "") -> list[dict]:
    """Classify sentiment of each text. Returns list of {i, sentiment, confidence}."""
    if not texts:
        return []

    indexed = "\n".join(f"[{i}] {t}" for i, t in enumerate(texts))
    ctx_line = f"Context: {context}\n" if context else ""

    system = (
        "You classify sentiment of short texts. "
        "Return STRICT JSON: an array of objects "
        '[{"i": <int>, "sentiment": "positive|neutral|negative|very_negative", '
        '"confidence": <float 0..1>}]. '
        "No prose, no markdown fences. One object per input index."
    )
    user = (
        f"{ctx_line}Classify each numbered text. Return one entry per index.\n\n"
        f"{indexed}"
    )

    raw = complete_simple(system=system, user=user, max_tokens=1024, temperature=0.0)
    try:
        parsed = json.loads(_strip_fences(raw))
    except json.JSONDecodeError:
        logger.warning("analyze_sentiment_batch: failed to parse JSON: %s", raw[:200])
        return [
            {"i": i, "sentiment": "neutral", "confidence": 0.0, "error": "parse_failed"}
            for i in range(len(texts))
        ]

    out: list[dict] = []
    for item in parsed if isinstance(parsed, list) else []:
        i = item.get("i")
        sent = item.get("sentiment", "neutral")
        if sent not in _SENTIMENT_VALUES:
            sent = "neutral"
        conf = item.get("confidence", 0.0)
        try:
            conf = float(conf)
        except (TypeError, ValueError):
            conf = 0.0
        out.append({"i": i, "sentiment": sent, "confidence": conf})
    return out


def summarize_text(text: str, max_words: int = 50) -> dict:
    """Summarize `text`. Returns {summary, key_points}."""
    system = (
        "You summarize text. Return STRICT JSON: "
        '{"summary": "<string>", "key_points": ["<string>", ...]}. '
        "No prose, no markdown fences."
    )
    user = (
        f"Summarize the following in <= {max_words} words. "
        "Also extract 2-5 key points.\n\n"
        f"TEXT:\n{text}"
    )
    raw = complete_simple(system=system, user=user, max_tokens=1024, temperature=0.2)
    try:
        parsed = json.loads(_strip_fences(raw))
    except json.JSONDecodeError:
        logger.warning("summarize_text: failed to parse JSON: %s", raw[:200])
        return {"summary": "", "key_points": [], "error": "parse_failed"}

    summary = parsed.get("summary", "") if isinstance(parsed, dict) else ""
    key_points = parsed.get("key_points", []) if isinstance(parsed, dict) else []
    if not isinstance(key_points, list):
        key_points = []
    return {"summary": str(summary), "key_points": [str(k) for k in key_points]}


def _strip_fences(s: str) -> str:
    """Remove leading/trailing markdown code fences if the model emitted them."""
    s = s.strip()
    if s.startswith("```"):
        # drop first fence line
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()


# ---------------------------------------------------------------------------
# Historical deals
# ---------------------------------------------------------------------------

def search_similar_historical_deals(
    industry: str,
    size: str,
    arr_range: list[float],
    status_filter: str = "all",
    limit: int = 5,
) -> list[dict]:
    """Look up historical deals matching industry+size with arr in arr_range."""
    sb = get_supabase()
    if not arr_range or len(arr_range) != 2:
        return [{"error": "arr_range must be [min, max]"}]
    arr_min, arr_max = float(arr_range[0]), float(arr_range[1])

    query = (
        sb.table("historical_deals")
        .select("*")
        .eq("industry", industry)
        .eq("size", size)
        .gte("arr_usd", arr_min)
        .lte("arr_usd", arr_max)
        .order("closed_at", desc=True)
        .limit(limit)
    )
    if status_filter != "all":
        if status_filter not in ("won", "lost", "churned", "expanded"):
            return [{"error": f"invalid status_filter: {status_filter}"}]
        query = query.eq("status", status_filter)
    res = query.execute()
    return res.data or []


# ---------------------------------------------------------------------------
# OpenAI tools schema
# ---------------------------------------------------------------------------

TOOLS_SPEC: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_account_details",
            "description": (
                "Get base info for an account (industry, size, plan, ARR, "
                "contract dates, champion). Returns the full account object."
            ),
            "parameters": {
                "type": "object",
                "required": ["account_id"],
                "properties": {
                    "account_id": {"type": "string", "description": "Account UUID"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_usage_events",
            "description": (
                "Get product usage events for the account. Supports filtering by "
                "date range and event type, and aggregation by day or week."
            ),
            "parameters": {
                "type": "object",
                "required": ["account_id"],
                "properties": {
                    "account_id": {"type": "string"},
                    "since_days_ago": {"type": "integer", "default": 90},
                    "event_types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of event_type values to filter by.",
                    },
                    "aggregate_by": {
                        "type": "string",
                        "enum": ["day", "week", "none"],
                        "default": "week",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tickets",
            "description": "Get support tickets for the account, including sentiment.",
            "parameters": {
                "type": "object",
                "required": ["account_id"],
                "properties": {
                    "account_id": {"type": "string"},
                    "status_filter": {
                        "type": "string",
                        "enum": ["all", "open", "unresolved"],
                        "default": "all",
                    },
                    "limit": {"type": "integer", "default": 20},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_conversations",
            "description": (
                "Get recent conversations with the account "
                "(emails, call transcripts, slack, meeting notes). Includes sentiment."
            ),
            "parameters": {
                "type": "object",
                "required": ["account_id"],
                "properties": {
                    "account_id": {"type": "string"},
                    "last_n": {"type": "integer", "default": 10},
                    "channel_filter": {
                        "type": "string",
                        "enum": ["all", "email", "call_transcript", "slack"],
                        "default": "all",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_sentiment_batch",
            "description": (
                "Analyze sentiment for a batch of short texts. Fast (uses a small model). "
                "Returns array of {i, sentiment, confidence}."
            ),
            "parameters": {
                "type": "object",
                "required": ["texts"],
                "properties": {
                    "texts": {"type": "array", "items": {"type": "string"}},
                    "context": {
                        "type": "string",
                        "description": "Optional context, e.g. 'support ticket'.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_text",
            "description": "Summarize a long text (e.g. call transcript). Uses a fast model.",
            "parameters": {
                "type": "object",
                "required": ["text"],
                "properties": {
                    "text": {"type": "string"},
                    "max_words": {"type": "integer", "default": 50},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_similar_historical_deals",
            "description": (
                "Search historical deals with a similar profile (industry, size, ARR). "
                "Used to reason about 'what happened before with accounts like this'."
            ),
            "parameters": {
                "type": "object",
                "required": ["industry", "size", "arr_range"],
                "properties": {
                    "industry": {"type": "string"},
                    "size": {"type": "string"},
                    "arr_range": {
                        "type": "array",
                        "items": {"type": "number"},
                        "minItems": 2,
                        "maxItems": 2,
                        "description": "[min_arr_usd, max_arr_usd]",
                    },
                    "status_filter": {
                        "type": "string",
                        "enum": ["all", "won", "lost", "churned", "expanded"],
                        "default": "all",
                    },
                    "limit": {"type": "integer", "default": 5},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_final_analysis",
            "description": (
                "Submit the final churn-risk analysis. Calling this terminates the "
                "agent loop. Provide a churn_risk_score (0-100), top_signals, "
                "predicted_churn_reason, confidence (0-1), and reasoning."
            ),
            "parameters": {
                "type": "object",
                "required": [
                    "churn_risk_score",
                    "top_signals",
                    "predicted_churn_reason",
                    "confidence",
                    "reasoning",
                ],
                "properties": {
                    "churn_risk_score": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 100,
                    },
                    "top_signals": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["signal", "value", "severity"],
                            "properties": {
                                "signal": {"type": "string"},
                                "value": {},
                                "severity": {
                                    "type": "string",
                                    "enum": ["low", "medium", "high"],
                                },
                            },
                        },
                    },
                    "predicted_churn_reason": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "reasoning": {"type": "string"},
                },
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Expansion-specific tools
# ---------------------------------------------------------------------------

# Plan tier ordering and feature catalog for the expansion agent.
PLAN_TIERS: list[str] = ["starter", "growth", "business", "enterprise"]

PLAN_FEATURES: dict[str, list[str]] = {
    "starter": ["basic_reports", "email_support"],
    "growth": ["advanced_reports", "api_access", "integrations"],
    "business": ["sso", "custom_dashboards", "priority_support", "audit_logs"],
    "enterprise": ["dedicated_csm", "sla", "sandbox_env", "custom_integrations"],
}


def _next_plan(current_plan: str) -> str | None:
    """Return the next-tier plan name, or None if already at the top tier."""
    try:
        idx = PLAN_TIERS.index(current_plan)
    except ValueError:
        return None
    if idx + 1 >= len(PLAN_TIERS):
        return None
    return PLAN_TIERS[idx + 1]


def get_seat_utilization(account_id: str, lookback_days: int = 90) -> dict:
    """Return seat utilization summary for the account.

    Returns: {current_utilization_pct, trend, weeks_at_high_utilization}
      - trend ∈ {"increasing","flat","decreasing"} from first vs last weekly bucket.
      - weeks_at_high_utilization: count of weekly buckets where utilization >= 85%.
    """
    sb = get_supabase()
    acct_res = (
        sb.table("accounts")
        .select("seats_active, seats_purchased")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    rows = acct_res.data or []
    if not rows:
        return {"error": f"account_not_found: {account_id}"}
    seats_active = int(rows[0].get("seats_active") or 0)
    seats_purchased = int(rows[0].get("seats_purchased") or 0)
    if seats_purchased <= 0:
        return {
            "current_utilization_pct": 0.0,
            "trend": "flat",
            "weeks_at_high_utilization": 0,
        }

    current_pct = round(seats_active / seats_purchased * 100, 1)

    # Walk user_invited / user_removed events backward to estimate seat counts per week.
    since = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    ev_res = (
        sb.table("usage_events")
        .select("event_type, occurred_at")
        .eq("account_id", account_id)
        .in_("event_type", ["user_invited", "user_removed"])
        .gte("occurred_at", since.isoformat())
        .order("occurred_at", desc=True)
        .execute()
    )
    events: list[dict] = ev_res.data or []

    # Build weekly buckets (Monday-anchored) over the lookback window.
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    weeks: list[Any] = []
    num_weeks = max(1, lookback_days // 7)
    for i in range(num_weeks):
        weeks.append(monday - timedelta(weeks=i))
    weeks.sort()  # oldest first

    # Walk backward in time from current seats_active. For events after week start,
    # invert: a user_invited that occurred AFTER bucket means seats were lower then.
    seats_at_week: dict[Any, int] = {}
    running = seats_active
    # Iterate weeks from newest to oldest, applying inversions.
    pending_events = list(events)  # newest first (already desc by occurred_at)
    pending_idx = 0

    for wk in reversed(weeks):  # newest week first
        wk_start = datetime(wk.year, wk.month, wk.day, tzinfo=timezone.utc)
        # Apply events that occurred AFTER this week's start (i.e., happened later)
        # to roll the count back to what it was at wk_start.
        while pending_idx < len(pending_events):
            ev = pending_events[pending_idx]
            ts_raw = ev.get("occurred_at")
            if not ts_raw:
                pending_idx += 1
                continue
            try:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            except ValueError:
                pending_idx += 1
                continue
            if ts >= wk_start:
                # invert: undo this event to estimate prior count
                if ev.get("event_type") == "user_invited":
                    running -= 1
                elif ev.get("event_type") == "user_removed":
                    running += 1
                pending_idx += 1
            else:
                break
        seats_at_week[wk] = max(0, running)

    # Build oldest->newest series of utilization pcts.
    series: list[float] = []
    for wk in weeks:
        sa = seats_at_week.get(wk, seats_active)
        series.append(round(sa / seats_purchased * 100, 1))
    # Append current week to the end if not already there.
    if not series or series[-1] != current_pct:
        series.append(current_pct)

    # Trend: first vs last bucket.
    if len(series) >= 2:
        first, last = series[0], series[-1]
        if last - first > 5:
            trend = "increasing"
        elif first - last > 5:
            trend = "decreasing"
        else:
            trend = "flat"
    else:
        trend = "flat"

    weeks_at_high = sum(1 for pct in series if pct >= 85.0)

    return {
        "current_utilization_pct": current_pct,
        "trend": trend,
        "weeks_at_high_utilization": weeks_at_high,
    }


def get_feature_adoption(account_id: str) -> dict:
    """Return feature adoption summary for the account.

    Returns: {features_used, features_in_higher_plan_unused, adoption_score}
    """
    sb = get_supabase()

    acct_res = (
        sb.table("accounts")
        .select("plan")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    acct_rows = acct_res.data or []
    if not acct_rows:
        return {"error": f"account_not_found: {account_id}"}
    current_plan = str(acct_rows[0].get("plan") or "").lower()

    ev_res = (
        sb.table("usage_events")
        .select("metadata, event_type")
        .eq("account_id", account_id)
        .eq("event_type", "feature_used")
        .execute()
    )
    events: list[dict] = ev_res.data or []

    used: set[str] = set()
    for ev in events:
        meta = ev.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except json.JSONDecodeError:
                meta = {}
        feat = None
        if isinstance(meta, dict):
            feat = meta.get("feature_name") or meta.get("feature")
        if feat:
            used.add(str(feat))

    features_used = sorted(used)

    next_plan = _next_plan(current_plan)
    if next_plan:
        next_features = set(PLAN_FEATURES.get(next_plan, []))
        features_in_higher_plan_unused = sorted(next_features - used)
    else:
        features_in_higher_plan_unused = []

    current_plan_features = PLAN_FEATURES.get(current_plan, [])
    adoption_score = round(
        len(used & set(current_plan_features))
        / max(len(current_plan_features), 1)
        * 100,
        1,
    )

    return {
        "features_used": features_used,
        "features_in_higher_plan_unused": features_in_higher_plan_unused,
        "adoption_score": adoption_score,
    }


TOOL_DISPATCH: dict[str, Callable[..., Any]] = {
    "get_account_details": get_account_details,
    "get_usage_events": get_usage_events,
    "get_tickets": get_tickets,
    "get_conversations": get_conversations,
    "analyze_sentiment_batch": analyze_sentiment_batch,
    "summarize_text": summarize_text,
    "search_similar_historical_deals": search_similar_historical_deals,
    "get_seat_utilization": get_seat_utilization,
    "get_feature_adoption": get_feature_adoption,
}


# ---------------------------------------------------------------------------
# Expansion agent tools spec
# ---------------------------------------------------------------------------

# Shared data tools (everything in TOOLS_SPEC except submit_final_analysis).
_SHARED_DATA_TOOLS: list[dict[str, Any]] = [
    t for t in TOOLS_SPEC if t["function"]["name"] != "submit_final_analysis"
]

EXPANSION_TOOLS_SPEC: list[dict[str, Any]] = [
    *_SHARED_DATA_TOOLS,
    {
        "type": "function",
        "function": {
            "name": "get_seat_utilization",
            "description": (
                "Return current seat utilization (active/purchased) for the account, "
                "the trend over the lookback window, and weeks at >=85% utilization."
            ),
            "parameters": {
                "type": "object",
                "required": ["account_id"],
                "properties": {
                    "account_id": {"type": "string"},
                    "lookback_days": {"type": "integer", "default": 90},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_feature_adoption",
            "description": (
                "Return which features the account has used, which features in the "
                "next-tier plan they have NOT used, and an adoption score for their "
                "current plan."
            ),
            "parameters": {
                "type": "object",
                "required": ["account_id"],
                "properties": {
                    "account_id": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_final_analysis",
            "description": (
                "Submit the final expansion analysis. Calling this terminates the agent "
                "loop. Provide an expansion_score (0-100), ready_to_expand boolean, "
                "recommended_plan, reasoning, and a suggested_upsell_message."
            ),
            "parameters": {
                "type": "object",
                "required": [
                    "expansion_score",
                    "ready_to_expand",
                    "recommended_plan",
                    "reasoning",
                    "suggested_upsell_message",
                ],
                "properties": {
                    "expansion_score": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 100,
                    },
                    "ready_to_expand": {"type": "boolean"},
                    "recommended_plan": {
                        "type": "string",
                        "enum": ["starter", "growth", "business", "enterprise"],
                    },
                    "reasoning": {"type": "string"},
                    "suggested_upsell_message": {"type": "string"},
                },
            },
        },
    },
]
