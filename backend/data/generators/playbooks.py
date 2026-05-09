"""12 seed playbooks for playbook_memory (CONTRACTS.md §4.3)."""

from __future__ import annotations

import uuid
from typing import Any


def build_playbook_memory_rows() -> list[dict[str, Any]]:
    """Hardcoded playbooks with realistic times_used / times_succeeded."""
    pb = []

    def _rate(used: int, ok: int) -> float:
        return round(ok / used, 2) if used else 0.0

    specs: list[dict[str, Any]] = [
        # 3 churn channels
        {
            "name": "churn_email_logins_drop",
            "channel": "email",
            "profile": {"industry": ["fintech", "ecommerce"], "size": ["smb", "mid_market"]},
            "signals": {"logins_drop_pct": 45, "tickets_negative_count": 2, "champion_changed": False},
            "tpl": "Hola {{champion}}, notamos una baja de actividad...",
            "reason": "Patrón: caída de logins + tickets negativos en SMB fintech/ecommerce.",
            "used": 11,
            "ok": 8,
        },
        {
            "name": "churn_whatsapp_escalation",
            "channel": "whatsapp",
            "profile": {"industry": ["healthtech", "logistics"], "size": ["mid_market"]},
            "signals": {"days_since_qbr": 95, "tickets_negative_count": 1},
            "tpl": "Mensaje corto de chequeo ejecutivo...",
            "reason": "QBR tardío + fricción en soporte; canal WhatsApp para respuesta rápida.",
            "used": 9,
            "ok": 6,
        },
        {
            "name": "churn_voice_critical",
            "channel": "voice_call",
            "profile": {"industry": ["manufacturing", "media"], "size": ["enterprise"]},
            "signals": {"logins_drop_pct": 60, "champion_changed": True},
            "tpl": "Script llamada: validar impacto, plan de remediación en 48h...",
            "reason": "Riesgo alto enterprise: voz para reconectar con sponsor.",
            "used": 7,
            "ok": 5,
        },
        # 3 expansion
        {
            "name": "expansion_seat_limit_email",
            "channel": "email",
            "profile": {"plan": ["growth", "business"], "size": ["smb", "mid_market"]},
            "signals": {"seat_utilization_pct": 92},
            "tpl": "Propuesta de upgrade por límite de seats...",
            "reason": "Seats cerca del tope + buen NPS.",
            "used": 14,
            "ok": 10,
        },
        {
            "name": "expansion_slack_feature_upsell",
            "channel": "slack",
            "profile": {"industry": ["fintech", "professional_services"], "size": ["mid_market"]},
            "signals": {"feature_adoption_score": 78},
            "tpl": "Mensaje Slack con demo de módulo premium...",
            "reason": "Adopción de features avanzadas indica readiness.",
            "used": 10,
            "ok": 7,
        },
        {
            "name": "expansion_whatsapp_roi",
            "channel": "whatsapp",
            "profile": {"industry": ["ecommerce", "hospitality"], "size": ["smb"]},
            "signals": {"expansion_score_hint": 70},
            "tpl": "Oferta bundle anual con ROI estimado...",
            "reason": "SMB verticales con sensibilidad a precio pero alto uso.",
            "used": 12,
            "ok": 8,
        },
        # 3 by industry cluster
        {
            "name": "industry_edtech_compliance",
            "channel": "email",
            "profile": {"industry": ["edtech"], "size": ["smb", "mid_market"]},
            "signals": {"compliance_topic": True, "tickets_negative_count": 1},
            "tpl": "Enfoque compliance / roles académicos...",
            "reason": "Edtech: preocupación por permisos y reporting.",
            "used": 8,
            "ok": 6,
        },
        {
            "name": "industry_healthtech_phi",
            "channel": "email",
            "profile": {"industry": ["healthtech"], "size": ["mid_market", "enterprise"]},
            "signals": {"security_review": True},
            "tpl": "Propuesta workshop seguridad + PHI...",
            "reason": "Healthtech: ciclo largo, foco en confianza.",
            "used": 9,
            "ok": 6,
        },
        {
            "name": "industry_fintech_audit",
            "channel": "slack",
            "profile": {"industry": ["fintech"], "size": ["enterprise"]},
            "signals": {"audit_log_adoption": True},
            "tpl": "Highlight de audit trail y alertas...",
            "reason": "Fintech enterprise valora trazabilidad.",
            "used": 11,
            "ok": 7,
        },
        # by size (+ 2 filas "evolution_*" abajo = 12 playbooks totales)
        {
            "name": "size_startup_time_to_value",
            "channel": "email",
            "profile": {"size": ["startup"]},
            "signals": {"days_since_signup": 21, "activation_incomplete": True},
            "tpl": "Checklist 14 días para activación...",
            "reason": "Startups: riesgo por onboarding incompleto.",
            "used": 15,
            "ok": 9,
        },
    ]

    for s in specs:
        used = int(s["used"])
        ok = int(s["ok"])
        pid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"seed-playbook:{s['name']}"))
        row = {
            "id": pid,
            "account_profile": s["profile"],
            "signal_pattern": s["signals"],
            "recommended_channel": s["channel"],
            "message_template": s["tpl"],
            "reasoning_template": s["reason"],
            "times_used": used,
            "times_succeeded": ok,
            "success_rate": _rate(used, ok),
            "version": 1,
            "superseded_by": None,
        }
        pb.append(row)

    # Par superseded (closed-loop): voz reemplaza email tras bajo desempeño — alimenta GET /playbooks + UI "evolución".
    new_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "seed-playbook:evolution_v2_voice_prechurn"))
    old_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "seed-playbook:evolution_v1_email_prechurn"))
    pb.append(
        {
            "id": old_id,
            "account_profile": {"industry": ["fintech"], "size": ["mid_market"], "plan": ["growth", "business"]},
            "signal_pattern": {"logins_drop_pct": 50, "tickets_negative_count": 2, "champion_changed": False},
            "recommended_channel": "email",
            "message_template": "Hola, vimos que tu uso bajó este mes. ¿Hay algo en lo que podamos ayudarte?",
            "reasoning_template": "Pre-churn mid-market: email genérico; tasa baja tras varios usos.",
            "times_used": 7,
            "times_succeeded": 2,
            "success_rate": _rate(7, 2),
            "version": 1,
            "superseded_by": new_id,
        }
    )
    pb.append(
        {
            "id": new_id,
            "account_profile": {"industry": ["fintech"], "size": ["mid_market"], "plan": ["growth", "business"]},
            "signal_pattern": {
                "logins_drop_pct": 50,
                "tickets_negative_count": 2,
                "champion_changed": False,
            },
            "recommended_channel": "voice_call",
            "message_template": "Hola, soy tu CSM. Vi la caída de uso y quiero entender en 15 min qué está frenando al equipo.",
            "reasoning_template": "Misma señal; llamada personal para recuperar contexto humano.",
            "times_used": 11,
            "times_succeeded": 8,
            "success_rate": _rate(11, 8),
            "version": 1,
            "superseded_by": None,
        }
    )
    return pb
