"""Pydantic models for Accounts API (CONTRACTS.md §2.1)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class CsmListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    email: str
    slack_handle: str | None = None


class AccountListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    account_number: str | None = None
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
    # Timestamp técnico de la fila en BD. Se expone para que el frontend pueda
    # ordenar las cuentas con el mismo criterio que el batch agent
    # (`backend.agents.batch_processor.submit_batch` usa `created_at desc`).
    created_at: datetime | None = None


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
    account_number: str | None = None
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


class AccountHealthHistoryItem(BaseModel):
    """Fila de account_health_history (CONTRACTS.md §2.1)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    account_id: str
    health_status: str
    churn_risk_score: int
    expansion_score: int
    top_signals: Any | None = None
    predicted_churn_reason: str | None = None
    crystal_ball_confidence: float | None = None
    computed_at: datetime
    computed_by_version: str


class AccountHealthHistoryListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AccountHealthHistoryItem]
    total: int
    limit: int
    offset: int


IndustryLiteral = Literal[
    "fintech",
    "healthtech",
    "edtech",
    "ecommerce",
    "saas",
    "logistics",
    "media",
    "manufacturing",
    "real_estate",
    "hospitality",
    "professional_services",
    "travel",
    "other",
]
SizeLiteral = Literal["startup", "smb", "mid_market", "enterprise"]
GeographyLiteral = Literal["latam", "us", "eu", "apac"]
PlanLiteral = Literal["starter", "growth", "business", "enterprise"]
NpsCategoryLiteral = Literal["detractor", "passive", "promoter"]
HealthStatusLiteral = Literal["critical", "at_risk", "stable", "healthy", "expanding"]


class InitialHealthPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    churn_risk_score: int = 25
    expansion_score: int = 30
    health_status: HealthStatusLiteral = "stable"
    predicted_churn_reason: str | None = None
    crystal_ball_reasoning: str = "Cuenta creada vía API; sin análisis Crystal Ball."


class CreateAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_number: str
    name: str
    industry: IndustryLiteral
    size: SizeLiteral
    geography: GeographyLiteral
    plan: PlanLiteral
    arr_usd: float
    seats_purchased: int
    seats_active: int
    signup_date: datetime
    contract_renewal_date: datetime
    champion_name: str
    champion_email: str
    champion_role: str
    champion_phone: str | None = None
    champion_changed_recently: bool = False
    csm_id: str
    last_qbr_date: datetime | None = None
    current_nps_score: int | None = None
    current_nps_category: NpsCategoryLiteral | None = None
    last_nps_at: datetime | None = None
    health: InitialHealthPayload = Field(default_factory=InitialHealthPayload)


class CreateAccountResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inserted: bool
    skipped: bool
    account_id: str | None = None
    message: str
