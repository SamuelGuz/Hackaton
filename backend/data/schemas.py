"""Typed literals and helpers aligned with CONTRACTS.md §1."""

from __future__ import annotations

from typing import Literal

# --- Buckets (synthetic generation only; not a DB column) ---
Bucket = Literal[
    "healthy_stable",
    "at_risk_subtle",
    "at_risk_obvious",
    "expansion_ready",
    "expansion_subtle",
]

Industry = Literal[
    "fintech",
    "healthtech",
    "edtech",
    "ecommerce",
    "logistics",
    "media",
    "manufacturing",
    "real_estate",
    "hospitality",
    "professional_services",
]

Size = Literal["startup", "smb", "mid_market", "enterprise"]
Geography = Literal["latam", "us", "eu", "apac"]
Plan = Literal["starter", "growth", "business", "enterprise"]

CsmRole = Literal["csm", "senior_csm", "csm_manager", "head_of_cs"]

UsageEventType = Literal[
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

TicketPriority = Literal["low", "medium", "high", "critical"]
TicketStatus = Literal["open", "in_progress", "resolved", "escalated"]
Sentiment = Literal["positive", "neutral", "negative", "very_negative"]

ConversationChannel = Literal["email", "call_transcript", "slack", "meeting_notes"]
ConversationDirection = Literal["inbound", "outbound", "internal"]

NpsCategory = Literal["detractor", "passive", "promoter"]
SurveyTrigger = Literal["quarterly", "post_ticket", "post_qbr", "post_renewal", "manual"]

HistoricalDealStatus = Literal["won", "lost", "churned", "expanded"]

HealthStatus = Literal["critical", "at_risk", "stable", "healthy", "expanding"]

PlaybookChannel = Literal["email", "slack", "whatsapp", "voice_call"]

INDUSTRIES: tuple[Industry, ...] = (
    "fintech",
    "healthtech",
    "edtech",
    "ecommerce",
    "logistics",
    "media",
    "manufacturing",
    "real_estate",
    "hospitality",
    "professional_services",
)


def nps_category_from_score(score: int) -> NpsCategory:
    if score <= 6:
        return "detractor"
    if score <= 8:
        return "passive"
    return "promoter"
