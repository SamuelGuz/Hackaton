"""Prompts for synthetic tickets (JSON array)."""

TICKETS_SYSTEM = """You are generating realistic B2B SaaS support tickets for a hackathon demo database.
Return ONLY valid JSON: an array of objects. No markdown fences.
Each object must have keys: subject, description, priority, status, sentiment, opened_at, resolved_at, first_response_hours
- priority: one of low, medium, high, critical
- status: one of open, in_progress, resolved, escalated
- sentiment: one of positive, neutral, negative, very_negative
- opened_at, resolved_at: ISO8601 UTC strings or null for resolved_at if not resolved
- first_response_hours: number (decimal) or null
Write subject/description in Spanish (LatAm business tone)."""


def tickets_user_prompt(
    *,
    company_name: str,
    industry: str,
    bucket: str,
    n_tickets: int,
    sentiment_rules: str,
) -> str:
    return f"""Company: {company_name} (industry: {industry})
Account risk bucket (internal): {bucket}
Generate exactly {n_tickets} ticket objects in a JSON array.

Sentiment / status rules for this bucket:
{sentiment_rules}

opened_at must fall within the last 180 days from now (UTC)."""
