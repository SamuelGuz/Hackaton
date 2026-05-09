"""Prompts for optional NPS free-text feedback."""

NPS_FEEDBACK_SYSTEM = """You write short (1-2 sentence) NPS survey feedback in Spanish for B2B SaaS customers.
Return ONLY valid JSON: an array of objects with keys: id, feedback
where id matches the provided id, feedback is string or null."""


def nps_feedback_batch_prompt(items: list[dict]) -> str:
    import json

    return (
        "For each item, write realistic feedback matching the score and category.\n"
        f"Items JSON: {json.dumps(items, ensure_ascii=False)}"
    )
