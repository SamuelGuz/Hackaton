"""Pydantic models for Interventions API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


InterventionStatusLiteral = Literal[
    "pending_approval", "rejected", "pending",
    "sent", "delivered", "opened", "responded", "failed",
]
InterventionOutcomeLiteral = Literal[
    "success", "partial", "no_response", "negative", "churned",
]
InterventionChannelLiteral = Literal["email", "slack", "whatsapp", "voice_call"]


class InterventionListItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    account_id: str
    account_name: str
    trigger_reason: str
    channel: InterventionChannelLiteral
    recipient: str
    message_subject: str | None = None
    message_body: str
    agent_reasoning: str
    confidence_score: float | None = None
    playbook_id_used: str | None = None
    requires_approval: bool
    approved_by: str | None = None
    approved_at: datetime | None = None
    auto_approved: bool
    rejection_reason: str | None = None
    status: InterventionStatusLiteral
    sent_at: datetime | None = None
    delivered_at: datetime | None = None
    responded_at: datetime | None = None
    outcome: InterventionOutcomeLiteral | None = None
    outcome_notes: str | None = None
    outcome_recorded_at: datetime | None = None
    created_at: datetime


class InterventionsListResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    interventions: list[InterventionListItem]
    total: int


class OutcomeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: InterventionOutcomeLiteral
    outcome_notes: str | None = None


class PlaybookUpdateInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    playbook_id: str
    previous_success_rate: float
    new_success_rate: float
    times_used: int
    deprecated: bool


class RegeneratedPlaybookInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    old_playbook_id: str
    new_playbook_id: str
    old_version: int
    new_version: int
    old_success_rate: float
    old_times_used: int
    channel_change: bool
    old_channel: str | None = None
    new_channel: str
    rationale: str


class OutcomeResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    intervention_id: str
    outcome_recorded: bool
    playbook_updated: PlaybookUpdateInfo | None = None
    regenerated_playbook: RegeneratedPlaybookInfo | None = None
