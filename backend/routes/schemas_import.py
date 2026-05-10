"""Pydantic models for Accounts Import API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


HealthStatusLiteral = Literal["critical", "at_risk", "stable", "healthy", "expanding"]


class ImportAccountRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
    champion_name: str
    champion_email: str
    champion_role: str
    champion_phone: str | None = None
    csm_assigned: str | None = None
    csm_id: str | None = None
    champion_changed_recently: bool = False
    last_qbr_date: datetime | None = None
    current_nps_score: int | None = None
    current_nps_category: Literal["detractor", "passive", "promoter"] | None = None
    last_nps_at: datetime | None = None

    churn_risk_score: int | None = None
    expansion_score: int | None = None
    health_status: HealthStatusLiteral | None = None
    predicted_churn_reason: str | None = None
    crystal_ball_reasoning: str | None = None

    @model_validator(mode="after")
    def validate_csm_reference(self) -> "ImportAccountRow":
        if not self.csm_id and not (self.csm_assigned and self.csm_assigned.strip()):
            raise ValueError("Se requiere csm_id o csm_assigned")
        return self


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accounts: list[ImportAccountRow] = Field(..., min_length=1, max_length=1000)


class ImportError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_index: int
    key: str
    message: str


class ImportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inserted: int
    skipped: int
    errors: list[ImportError]
    inserted_ids: list[str]


class AccountReferenceMixin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str | None = None
    account_number: str | None = None

    @model_validator(mode="after")
    def validate_account_reference(self) -> "AccountReferenceMixin":
        if not self.account_id and not self.account_number:
            raise ValueError("Se requiere account_id o account_number")
        return self


UsageEventTypeLiteral = Literal[
    "login",
    "feature_used",
    "report_generated",
    "api_call",
    "integration_connected",
    "integration_disconnected",
    "user_invited",
    "user_removed",
    "admin_action",
]
TicketPriorityLiteral = Literal["low", "medium", "high", "critical"]
TicketStatusLiteral = Literal["open", "in_progress", "resolved", "escalated"]
ConversationChannelLiteral = Literal["email", "call_transcript", "slack", "meeting_notes"]
DirectionLiteral = Literal["inbound", "outbound", "internal"]
SentimentLiteral = Literal["positive", "neutral", "negative", "very_negative"]


class ImportUsageEventRow(AccountReferenceMixin):
    event_type: UsageEventTypeLiteral
    feature_name: str | None = None
    user_email: str | None = None
    occurred_at: datetime
    metadata: dict = Field(default_factory=dict)


class ImportUsageEventsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[ImportUsageEventRow] = Field(..., min_length=1, max_length=5000)


class ImportTicketRow(AccountReferenceMixin):
    subject: str
    description: str
    priority: TicketPriorityLiteral
    status: TicketStatusLiteral
    sentiment: SentimentLiteral | None = None
    opened_at: datetime
    resolved_at: datetime | None = None
    first_response_hours: float | None = None


class ImportTicketsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[ImportTicketRow] = Field(..., min_length=1, max_length=5000)


class ImportConversationRow(AccountReferenceMixin):
    channel: ConversationChannelLiteral
    direction: DirectionLiteral
    participants: list[str]
    subject: str | None = None
    content: str
    sentiment: SentimentLiteral | None = None
    occurred_at: datetime


class ImportConversationsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[ImportConversationRow] = Field(..., min_length=1, max_length=5000)


class RelatedImportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inserted: int
    errors: list[ImportError]
