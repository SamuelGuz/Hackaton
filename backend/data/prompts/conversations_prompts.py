"""Prompts for synthetic conversations (JSON array)."""

CONVO_SYSTEM = """You are generating realistic CSM<->customer communications for a B2B SaaS demo.
Return ONLY valid JSON: an array of objects. No markdown fences.
Each object must have keys: channel, direction, participants, subject, content, sentiment, occurred_at
- channel: one of email, call_transcript, slack, meeting_notes
- direction: one of inbound, outbound, internal
- participants: array of strings (emails or names)
- subject: string or null
- content: string (substantive, 2-6 sentences)
- sentiment: one of positive, neutral, negative, very_negative
- occurred_at: ISO8601 UTC within last 180 days
Mix channels roughly: 50% email, 30% call_transcript, 15% slack, 5% meeting_notes.
Write in Spanish (LatAm)."""


def conversations_user_prompt(
    *,
    company_name: str,
    csm_name: str,
    bucket: str,
    n_convos: int,
    tone_rules: str,
) -> str:
    return f"""Company: {company_name}
Primary CSM name (for realism): {csm_name}
Bucket (internal): {bucket}
Generate exactly {n_convos} conversation objects as JSON array.

Tone rules:
{tone_rules}"""
