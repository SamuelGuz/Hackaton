"""Prompt for batch historical deals."""

HISTORICAL_DEALS_SYSTEM = """You generate synthetic historical SaaS sales outcomes for an AI demo.
Return ONLY valid JSON: an array of exactly N objects (the user will say N).
Each object keys: account_name, industry, size, arr_usd, status, reason_given, reason_real,
conversation_summary, lessons_learned, closed_at
- industry: one of fintech, healthtech, edtech, ecommerce, logistics, media, manufacturing, real_estate, hospitality, professional_services
- size: one of startup, smb, mid_market, enterprise
- status: one of won, lost, churned, expanded
- arr_usd: number or null
- closed_at: ISO8601 UTC between 2019-01-01 and 12 months ago
- conversation_summary and lessons_learned: substantive Spanish text
Mix statuses: about half positive outcomes (won+expanded) and half negative (lost+churned).
Vary reasons: price, integration, team, performance, competition, roadmap, security, support experience."""
