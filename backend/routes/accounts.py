"""Accounts API routes (CONTRACTS.md §2.1)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query

from backend.routes.schemas_accounts import (
    AccountDetailResponse,
    AccountListItem,
    AccountsListResponse,
    ChampionDetail,
    CsmDetail,
    CsmListItem,
    HealthDetail,
    HealthTopSignal,
    NpsDetail,
    TimelineEvent,
    TimelineResponse,
)
from backend.shared.supabase_client import get_client

router = APIRouter(prefix="/accounts", tags=["accounts"])

_TIMELINE_PER_SOURCE = 100
_TIMELINE_MAX_EVENTS = 400
_DEFAULT_TS = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _http_error(status: int, code: str, message: str, details: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"error": code, "message": message, "details": details or {}},
    )


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        s = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            return None
    return None


def _num(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _int(v: Any, default: int = 0) -> int:
    return int(round(_num(v, float(default))))


def _one(row: dict[str, Any], key: str) -> dict[str, Any] | None:
    val = row.get(key)
    if isinstance(val, list):
        return val[0] if val else None
    if isinstance(val, dict):
        return val
    return None


def _trend_direction(current: int, previous: int | None) -> Literal["improving", "stable", "worsening"]:
    if previous is None:
        return "stable"
    delta = current - previous
    if delta > 2:
        return "worsening"
    if delta < -2:
        return "improving"
    return "stable"


def _normalize_top_signals(raw: Any, *, churn_risk: int, expansion_score: int) -> list[HealthTopSignal]:
    """Map JSONB top_signals from snapshot/history to CONTRACTS.md list shape."""
    items: list[Any]
    if raw is None:
        items = []
    elif isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = [raw]
    else:
        items = []

    out: list[HealthTopSignal] = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        if "signal" in item and "severity" in item and "value" in item:
            sev_raw = item["severity"]
            sev: Literal["low", "medium", "high"] = (
                sev_raw if sev_raw in ("low", "medium", "high") else "medium"
            )
            val = item["value"]
            if not isinstance(val, (int, float, str)):
                val = str(val)
            out.append(HealthTopSignal(signal=str(item["signal"]), value=val, severity=sev))
            continue
        if item.get("signal") == "login_trend":
            direction = str(item.get("direction", "flat"))
            value_map = {"down": 62, "up": 15, "flat": 8}
            sev_lt: Literal["low", "medium", "high"] = (
                "high" if direction == "down" else ("medium" if direction == "flat" else "low")
            )
            out.append(
                HealthTopSignal(signal="logins_drop_pct", value=value_map.get(direction, 20), severity=sev_lt)
            )
            continue
        if item.get("signal") == "ticket_sentiment":
            val = str(item.get("value", "neutral"))
            sev_ts: Literal["low", "medium", "high"] = (
                "high" if val in ("negative", "very_negative", "mixed") else "medium"
            )
            out.append(HealthTopSignal(signal="ticket_sentiment", value=val, severity=sev_ts))
            continue
        if "demo_trap" in item:
            kind = item.get("demo_trap") or item.get("kind") or "demo_trap"
            out.append(HealthTopSignal(signal="demo_trap", value=str(kind), severity="high"))
            continue
        note = item.get("note")
        if note:
            out.append(HealthTopSignal(signal=f"signal_{i}", value=str(note)[:180], severity="medium"))
        else:
            out.append(HealthTopSignal(signal=f"signal_{i}", value=str(item)[:180], severity="medium"))

    if not out:
        out.append(HealthTopSignal(signal="churn_risk_score", value=churn_risk, severity="medium"))
        out.append(HealthTopSignal(signal="expansion_score", value=expansion_score, severity="low"))
    return out[:20]


def _snippet(text: str | None, max_len: int = 160) -> str:
    if not text:
        return ""
    t = " ".join(text.split())
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _collect_matching_account_ids(
    *,
    health_status: str | None,
    industry: str | None,
) -> list[str]:
    client = get_client()
    ids: set[str] | None = None

    if health_status:
        snap = (
            client.table("account_health_snapshot")
            .select("account_id")
            .eq("health_status", health_status)
            .execute()
        )
        ids = {str(r["account_id"]) for r in (snap.data or [])}

    if industry:
        acc = client.table("accounts").select("id").eq("industry", industry).execute()
        ind_ids = {str(r["id"]) for r in (acc.data or [])}
        ids = ind_ids if ids is None else ids & ind_ids

    if ids is not None:
        return sorted(ids)

    acc = client.table("accounts").select("id").execute()
    return sorted(str(r["id"]) for r in (acc.data or []))


def _fetch_accounts_rows(account_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not account_ids:
        return {}
    client = get_client()
    select = (
        "id,account_number,name,industry,size,plan,arr_usd,champion_name,champion_email,champion_role,champion_phone,"
        "champion_changed_recently,geography,seats_purchased,seats_active,signup_date,"
        "contract_renewal_date,last_qbr_date,current_nps_score,current_nps_category,last_nps_at,"
        "csm_id,"
        "csm_team(id,name,email,slack_handle,slack_user_id,phone,role),"
        "account_health_snapshot("
        "churn_risk_score,expansion_score,health_status,top_signals,predicted_churn_reason,"
        "crystal_ball_reasoning,ready_to_expand"
        ")"
    )
    out: dict[str, dict[str, Any]] = {}
    chunk = 120
    for i in range(0, len(account_ids), chunk):
        part = account_ids[i : i + chunk]
        res = client.table("accounts").select(select).in_("id", part).execute()
        for row in res.data or []:
            out[str(row["id"])] = row
    return out


@router.get("", response_model=AccountsListResponse)
def list_accounts(
    health_status: str | None = Query(default=None, description="Filter by health_status from snapshot"),
    industry: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AccountsListResponse:
    matching = _collect_matching_account_ids(health_status=health_status, industry=industry)
    total = len(matching)
    page_ids = matching[offset : offset + limit]
    rows_by_id = _fetch_accounts_rows(page_ids)
    page_ids = sorted(page_ids, key=lambda aid: str((rows_by_id.get(aid) or {}).get("name") or "").lower())

    accounts: list[AccountListItem] = []
    for aid in page_ids:
        row = rows_by_id.get(aid)
        if not row:
            continue
        csm = _one(row, "csm_team")
        snap = _one(row, "account_health_snapshot")
        if not csm:
            continue
        if not snap:
            snap = {
                "health_status": "stable",
                "churn_risk_score": 0,
                "expansion_score": 0,
            }
        crd = _parse_ts(row.get("contract_renewal_date")) or _DEFAULT_TS
        accounts.append(
            AccountListItem(
                id=str(row["id"]),
                account_number=str(row.get("account_number") or ""),
                name=str(row["name"]),
                industry=str(row["industry"]),
                size=str(row["size"]),
                plan=str(row["plan"]),
                arr_usd=_num(row.get("arr_usd")),
                champion_name=str(row.get("champion_name") or ""),
                champion_phone=row.get("champion_phone"),
                csm=CsmListItem(
                    id=str(csm["id"]),
                    name=str(csm["name"]),
                    email=str(csm["email"]),
                    slack_handle=csm.get("slack_handle"),
                ),
                contract_renewal_date=crd,
                health_status=str(snap.get("health_status") or "stable"),
                churn_risk_score=_int(snap.get("churn_risk_score")),
                expansion_score=_int(snap.get("expansion_score")),
                current_nps_score=_int(row["current_nps_score"]) if row.get("current_nps_score") is not None else None,
                current_nps_category=row.get("current_nps_category"),
                last_nps_at=_parse_ts(row.get("last_nps_at")),
            )
        )

    return AccountsListResponse(accounts=accounts, total=total)


@router.get("/{account_id}/timeline", response_model=TimelineResponse)
def get_account_timeline(account_id: str) -> TimelineResponse:
    client = get_client()
    exists = client.table("accounts").select("id").eq("id", account_id).limit(1).execute()
    if not (exists.data or []):
        raise _http_error(404, "not_found", "Account not found", {"account_id": account_id})

    events: list[TimelineEvent] = []

    usage = (
        client.table("usage_events")
        .select("event_type,feature_name,user_email,occurred_at,metadata")
        .eq("account_id", account_id)
        .order("occurred_at", desc=True)
        .limit(_TIMELINE_PER_SOURCE)
        .execute()
    )
    for u in usage.data or []:
        ts = _parse_ts(u.get("occurred_at"))
        if not ts:
            continue
        feat = u.get("feature_name")
        extra = f" ({feat})" if feat else ""
        summary = f"Uso: {u.get('event_type')}{extra}"
        if u.get("user_email"):
            summary += f" — {u.get('user_email')}"
        events.append(
            TimelineEvent(
                type="usage_event",
                subtype=str(u.get("event_type") or "unknown"),
                timestamp=ts,
                summary=_snippet(summary, 220),
            )
        )

    tickets = (
        client.table("tickets")
        .select("subject,sentiment,status,opened_at,resolved_at,priority")
        .eq("account_id", account_id)
        .order("opened_at", desc=True)
        .limit(_TIMELINE_PER_SOURCE)
        .execute()
    )
    for t in tickets.data or []:
        ts = _parse_ts(t.get("opened_at"))
        if not ts:
            continue
        sent = t.get("sentiment") or "n/a"
        summary = f"Ticket abierto: {_snippet(str(t.get('subject') or ''), 120)} (sentiment: {sent}, priority: {t.get('priority')})"
        events.append(
            TimelineEvent(
                type="ticket",
                subtype="opened",
                timestamp=ts,
                summary=summary,
            )
        )
        if t.get("resolved_at"):
            ts_r = _parse_ts(t.get("resolved_at"))
            if ts_r:
                events.append(
                    TimelineEvent(
                        type="ticket",
                        subtype="resolved",
                        timestamp=ts_r,
                        summary=f"Ticket resuelto: {_snippet(str(t.get('subject') or ''), 120)}",
                    )
                )

    convs = (
        client.table("conversations")
        .select("channel,direction,subject,content,sentiment,occurred_at")
        .eq("account_id", account_id)
        .order("occurred_at", desc=True)
        .limit(_TIMELINE_PER_SOURCE)
        .execute()
    )
    for c in convs.data or []:
        ts = _parse_ts(c.get("occurred_at"))
        if not ts:
            continue
        subj = c.get("subject") or "Sin asunto"
        body = _snippet(str(c.get("content") or ""), 100)
        summary = f"{c.get('direction')} {c.get('channel')}: {subj} — {body}"
        events.append(
            TimelineEvent(
                type="conversation",
                subtype=str(c.get("channel") or "unknown"),
                timestamp=ts,
                summary=_snippet(summary, 240),
            )
        )

    nps_rows = (
        client.table("nps_responses")
        .select("score,category,feedback,survey_trigger,submitted_at,respondent_email")
        .eq("account_id", account_id)
        .order("submitted_at", desc=True)
        .limit(_TIMELINE_PER_SOURCE)
        .execute()
    )
    for n in nps_rows.data or []:
        ts = _parse_ts(n.get("submitted_at"))
        if not ts:
            continue
        fb = f" — {_snippet(str(n.get('feedback') or ''), 100)}" if n.get("feedback") else ""
        summary = f"NPS {n.get('score')} ({n.get('category')}){fb}"
        events.append(
            TimelineEvent(
                type="nps_response",
                subtype=str(n.get("survey_trigger") or n.get("category") or "survey"),
                timestamp=ts,
                summary=_snippet(summary, 240),
            )
        )

    health_h = (
        client.table("account_health_history")
        .select("health_status,churn_risk_score,expansion_score,computed_at,predicted_churn_reason")
        .eq("account_id", account_id)
        .order("computed_at", desc=True)
        .limit(_TIMELINE_PER_SOURCE)
        .execute()
    )
    for h in health_h.data or []:
        ts = _parse_ts(h.get("computed_at"))
        if not ts:
            continue
        summary = (
            f"Health snapshot: status={h.get('health_status')}, "
            f"churn_risk={h.get('churn_risk_score')}, expansion={h.get('expansion_score')}"
        )
        if h.get("predicted_churn_reason"):
            summary += f" — {_snippet(str(h['predicted_churn_reason']), 80)}"
        events.append(
            TimelineEvent(
                type="health_history",
                subtype=str(h.get("health_status") or "unknown"),
                timestamp=ts,
                summary=_snippet(summary, 260),
            )
        )

    interv = (
        client.table("interventions")
        .select(
            "trigger_reason,channel,status,message_subject,created_at,sent_at,delivered_at,responded_at"
        )
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(_TIMELINE_PER_SOURCE)
        .execute()
    )
    for inv in interv.data or []:
        ts = (
            _parse_ts(inv.get("responded_at"))
            or _parse_ts(inv.get("delivered_at"))
            or _parse_ts(inv.get("sent_at"))
            or _parse_ts(inv.get("created_at"))
        )
        if not ts:
            continue
        subj = inv.get("message_subject") or ""
        summary = f"Intervención [{inv.get('status')}]: {inv.get('trigger_reason')} via {inv.get('channel')}"
        if subj:
            summary += f" — {subj}"
        events.append(
            TimelineEvent(
                type="intervention",
                subtype=str(inv.get("channel") or "unknown"),
                timestamp=ts,
                summary=_snippet(summary, 260),
            )
        )

    events.sort(key=lambda e: e.timestamp, reverse=True)
    events = events[:_TIMELINE_MAX_EVENTS]

    return TimelineResponse(account_id=account_id, events=events)


@router.get("/{account_id}", response_model=AccountDetailResponse)
def get_account(account_id: str) -> AccountDetailResponse:
    client = get_client()
    select = (
        "id,account_number,name,industry,size,plan,arr_usd,geography,seats_purchased,seats_active,signup_date,"
        "contract_renewal_date,champion_name,champion_email,champion_role,champion_phone,champion_changed_recently,"
        "last_qbr_date,current_nps_score,current_nps_category,last_nps_at,"
        "csm_team(id,name,email,slack_handle,slack_user_id,phone,role),"
        "account_health_snapshot("
        "churn_risk_score,expansion_score,health_status,top_signals,predicted_churn_reason,"
        "crystal_ball_reasoning,ready_to_expand"
        ")"
    )
    res = client.table("accounts").select(select).eq("id", account_id).limit(1).execute()
    rows = res.data or []
    if not rows:
        raise _http_error(404, "not_found", "Account not found", {"account_id": account_id})
    row = rows[0]

    csm = _one(row, "csm_team")
    snap = _one(row, "account_health_snapshot")
    if not csm:
        raise _http_error(500, "data_integrity", "Account missing CSM assignment", {"account_id": account_id})
    if not snap:
        snap = {
            "churn_risk_score": 25,
            "expansion_score": 30,
            "health_status": "stable",
            "top_signals": [],
            "predicted_churn_reason": None,
            "crystal_ball_reasoning": "Sin snapshot de salud. Ejecutar Crystal Ball.",
            "ready_to_expand": False,
        }

    hist = (
        client.table("account_health_history")
        .select("churn_risk_score,computed_at")
        .eq("account_id", account_id)
        .order("computed_at", desc=True)
        .limit(5)
        .execute()
    )
    hist_rows = list(hist.data or [])
    penultimate_churn: int | None = None
    if len(hist_rows) >= 2:
        penultimate_churn = _int(hist_rows[1].get("churn_risk_score"))

    churn = _int(snap.get("churn_risk_score"))
    expansion = _int(snap.get("expansion_score"))
    health_status = str(snap.get("health_status") or "stable")
    top_raw = snap.get("top_signals")
    top_signals = _normalize_top_signals(top_raw, churn_risk=churn, expansion_score=expansion)

    nps_count_r = (
        client.table("nps_responses").select("id", count="exact").eq("account_id", account_id).execute()
    )
    history_count = int(nps_count_r.count) if nps_count_r.count is not None else len(
        client.table("nps_responses").select("id").eq("account_id", account_id).execute().data or []
    )

    last_nps = (
        client.table("nps_responses")
        .select("score,category,feedback,submitted_at")
        .eq("account_id", account_id)
        .order("submitted_at", desc=True)
        .limit(1)
        .execute()
    )
    last_row = (last_nps.data or [None])[0]

    trend = _trend_direction(churn, penultimate_churn)

    crystal_reasoning = str(snap.get("crystal_ball_reasoning") or "Sin análisis Crystal Ball reciente en snapshot.")

    return AccountDetailResponse(
        id=str(row["id"]),
        account_number=str(row.get("account_number") or ""),
        name=str(row["name"]),
        industry=str(row["industry"]),
        size=str(row["size"]),
        geography=str(row["geography"]),
        plan=str(row["plan"]),
        arr_usd=_num(row.get("arr_usd")),
        seats_purchased=_int(row.get("seats_purchased")),
        seats_active=_int(row.get("seats_active")),
        signup_date=_parse_ts(row.get("signup_date")) or _DEFAULT_TS,
        contract_renewal_date=_parse_ts(row.get("contract_renewal_date")) or _DEFAULT_TS,
        champion=ChampionDetail(
            name=str(row.get("champion_name") or ""),
            email=str(row.get("champion_email") or ""),
            role=str(row.get("champion_role") or ""),
            phone=row.get("champion_phone"),
            changed_recently=bool(row.get("champion_changed_recently")),
        ),
        csm=CsmDetail(
            id=str(csm["id"]),
            name=str(csm["name"]),
            email=str(csm["email"]),
            slack_handle=csm.get("slack_handle"),
            slack_user_id=csm.get("slack_user_id"),
            phone=csm.get("phone"),
            role=str(csm["role"]),
        ),
        last_qbr_date=_parse_ts(row.get("last_qbr_date")),
        nps=NpsDetail(
            current_score=_int(row["current_nps_score"]) if row.get("current_nps_score") is not None else None,
            current_category=row.get("current_nps_category"),
            last_submitted_at=_parse_ts(row.get("last_nps_at")),
            last_feedback=(str(last_row["feedback"]) if last_row and last_row.get("feedback") else None),
            history_count=history_count,
        ),
        health=HealthDetail(
            status=health_status,
            churn_risk_score=churn,
            previous_churn_risk_score=penultimate_churn,
            trend_direction=trend,
            top_signals=top_signals,
            predicted_churn_reason=(
                str(snap["predicted_churn_reason"]) if snap.get("predicted_churn_reason") else None
            ),
            crystal_ball_reasoning=crystal_reasoning,
            expansion_score=expansion,
            ready_to_expand=bool(snap.get("ready_to_expand")),
        ),
    )
