"""Pydantic models for Accounts Import API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


HealthStatusLiteral = Literal["critical", "at_risk", "stable", "healthy", "expanding"]


class ImportAccountRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
    csm_assigned: str

    churn_risk_score: int | None = None
    expansion_score: int | None = None
    health_status: HealthStatusLiteral | None = None


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accounts: list[ImportAccountRow] = Field(..., min_length=1, max_length=1000)


class ImportError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_index: int
    name: str
    message: str


class ImportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inserted: int
    skipped: int
    errors: list[ImportError]
    inserted_ids: list[str]
