"""POST /accounts/import — idempotent merge from Excel uploads."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter

from backend.routes.schemas_import import (
    ImportError,
    ImportRequest,
    ImportResponse,
)
from backend.shared.supabase_client import get_client

router = APIRouter(prefix="/accounts", tags=["accounts"])

_IMPORT_VERSION = "excel-import-v1"


@router.post("/import", response_model=ImportResponse)
def import_accounts(request: ImportRequest) -> ImportResponse:
    client = get_client()

    csm_rows = client.table("csm_team").select("id,name").execute().data or []
    csm_map: dict[str, str] = {
        str(row["name"]).strip().lower(): str(row["id"])
        for row in csm_rows
        if row.get("name") and row.get("id")
    }

    existing_rows = (
        client.table("accounts").select("name,champion_email").execute().data or []
    )
    existing_keys: set[tuple[str, str]] = {
        (
            str(row.get("name") or "").strip().lower(),
            str(row.get("champion_email") or "").strip().lower(),
        )
        for row in existing_rows
    }

    inserted_ids: list[str] = []
    errors: list[ImportError] = []
    skipped = 0

    for idx, row in enumerate(request.accounts):
        name = row.name.strip()
        email = row.champion_email.strip()

        if not email:
            errors.append(
                ImportError(
                    row_index=idx,
                    name=name,
                    message="champion_email requerido para dedupe",
                )
            )
            continue

        key = (name.lower(), email.lower())
        if key in existing_keys:
            skipped += 1
            continue

        csm_id = csm_map.get(row.csm_assigned.strip().lower())
        if not csm_id:
            errors.append(
                ImportError(
                    row_index=idx,
                    name=name,
                    message=f"CSM '{row.csm_assigned}' no encontrado",
                )
            )
            continue

        account_id = str(uuid.uuid4())
        account_payload = {
            "id": account_id,
            "name": name,
            "industry": row.industry,
            "size": row.size,
            "geography": row.geography,
            "plan": row.plan,
            "arr_usd": row.arr_usd,
            "seats_purchased": row.seats_purchased,
            "seats_active": row.seats_active,
            "signup_date": row.signup_date.isoformat(),
            "contract_renewal_date": row.contract_renewal_date.isoformat(),
            "champion_name": row.champion_name,
            "champion_email": email,
            "champion_role": row.champion_role,
            "champion_phone": row.champion_phone.strip() if row.champion_phone else None,
            "csm_id": csm_id,
        }

        try:
            client.table("accounts").insert(account_payload).execute()
        except Exception as exc:
            errors.append(
                ImportError(
                    row_index=idx,
                    name=name,
                    message=f"insert account falló: {exc}",
                )
            )
            continue

        inserted_ids.append(account_id)
        existing_keys.add(key)

        has_health = (
            row.churn_risk_score is not None
            or row.expansion_score is not None
            or row.health_status is not None
        )
        if has_health:
            now_iso = datetime.now(timezone.utc).isoformat()
            churn = row.churn_risk_score if row.churn_risk_score is not None else 25
            expansion = row.expansion_score if row.expansion_score is not None else 30
            status = row.health_status or "stable"

            snapshot_payload = {
                "account_id": account_id,
                "churn_risk_score": churn,
                "expansion_score": expansion,
                "health_status": status,
                "top_signals": [],
                "predicted_churn_reason": None,
                "crystal_ball_confidence": None,
                "crystal_ball_reasoning": "Importado desde Excel; sin análisis Crystal Ball.",
                "ready_to_expand": expansion >= 60,
                "recommended_plan": None,
                "expansion_reasoning": None,
                "suggested_upsell_message": None,
                "computed_at": now_iso,
                "computed_by_version": _IMPORT_VERSION,
            }
            history_payload = {
                "id": str(uuid.uuid4()),
                "account_id": account_id,
                "churn_risk_score": churn,
                "expansion_score": expansion,
                "health_status": status,
                "top_signals": [],
                "predicted_churn_reason": None,
                "crystal_ball_confidence": None,
                "computed_at": now_iso,
                "computed_by_version": _IMPORT_VERSION,
            }

            try:
                client.table("account_health_snapshot").upsert(
                    snapshot_payload, on_conflict="account_id"
                ).execute()
                client.table("account_health_history").insert(history_payload).execute()
            except Exception as exc:
                errors.append(
                    ImportError(
                        row_index=idx,
                        name=name,
                        message=f"snapshot/history opcional falló: {exc}",
                    )
                )

    return ImportResponse(
        inserted=len(inserted_ids),
        skipped=skipped,
        errors=errors,
        inserted_ids=inserted_ids,
    )
