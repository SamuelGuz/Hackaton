"""Pydantic models for Accounts API (CONTRACTS.md §2.1)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class CsmListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    email: str
    slack_handle: str | None = None


class AccountListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    account_number: str
    name: str
    industry: str
    size: str
    plan: str
    arr_usd: float
    champion_name: str
    champion_phone: str | None = None
    csm: CsmListItem
    contract_renewal_date: datetime
    health_status: str
    churn_risk_score: int
    expansion_score: int
    current_nps_score: int | None = None
    current_nps_category: str | None = None
    last_nps_at: datetime | None = None


class AccountsListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accounts: list[AccountListItem]
    total: int


class ChampionDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    email: str
    role: str
    phone: str | None = None
    changed_recently: bool


class CsmDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    email: str
    slack_handle: str | None = None
    slack_user_id: str | None = None
    phone: str | None = None
    role: str


class NpsDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_score: int | None = None
    current_category: str | None = None
    last_submitted_at: datetime | None = None
    last_feedback: str | None = None
    history_count: int


class HealthTopSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal: str
    value: int | float | str
    severity: Literal["low", "medium", "high"]


class HealthDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    churn_risk_score: int
    previous_churn_risk_score: int | None = None
    trend_direction: Literal["improving", "stable", "worsening"]
    top_signals: list[HealthTopSignal]
    predicted_churn_reason: str | None = None
    crystal_ball_reasoning: str
    expansion_score: int
    ready_to_expand: bool


class AccountDetailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    account_number: str
    name: str
    industry: str
    size: str
    geography: str
    plan: str
    arr_usd: float
    seats_purchased: int
    seats_active: int
    signup_date: datetime
    contract_renewal_date: datetime
    champion: ChampionDetail
    csm: CsmDetail
    last_qbr_date: datetime | None = None
    nps: NpsDetail
    health: HealthDetail


class TimelineEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    subtype: str
    timestamp: datetime
    summary: str


class TimelineResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str
    events: list[TimelineEvent]
