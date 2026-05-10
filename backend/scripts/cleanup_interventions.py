"""Borra intervenciones puntuales por nombre de cuenta + fecha.

Uso:
    # Dry-run (default): muestra qué borraría, pero no ejecuta el DELETE.
    python -m backend.scripts.cleanup_interventions

    # Ejecuta el DELETE real:
    python -m backend.scripts.cleanup_interventions --apply

Lee SUPABASE_URL / SUPABASE_KEY desde el .env del repo (vía backend.shared.supabase_client).
Pensado para limpieza manual durante desarrollo/hackathon: NO lo expongas como endpoint
ni lo invoques desde código de producción.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone

from backend.shared.supabase_client import get_client

# Filas a borrar: (nombre exacto de la cuenta, fecha en la que se creó la intervención).
# El match por fecha evita arrastrar intervenciones viejas si la cuenta vuelve a usarse.
TARGETS: list[tuple[str, date]] = [
    ("Analytics Datics", date(2026, 5, 10)),
]


def _start_of_day(d: date) -> str:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).isoformat()


def _end_of_day(d: date) -> str:
    return datetime(d.year, d.month, d.day, 23, 59, 59, 999_999, tzinfo=timezone.utc).isoformat()


def _find_account_id(client, name: str) -> str | None:
    res = client.table("accounts").select("id,name").eq("name", name).limit(2).execute()
    rows = res.data or []
    if not rows:
        print(f"  [skip] No existe cuenta con name='{name}'")
        return None
    if len(rows) > 1:
        ids = ", ".join(r["id"] for r in rows)
        print(f"  [skip] Hay >1 cuenta con name='{name}' ({ids}); resolvelo a mano")
        return None
    return rows[0]["id"]


def _find_interventions(client, account_id: str, day: date) -> list[dict]:
    res = (
        client.table("interventions")
        .select("id, status, channel, created_at")
        .eq("account_id", account_id)
        .gte("created_at", _start_of_day(day))
        .lte("created_at", _end_of_day(day))
        .order("created_at", desc=True)
        .execute()
    )
    return list(res.data or [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Ejecuta el DELETE. Sin esta flag corre en modo dry-run.",
    )
    args = parser.parse_args()

    client = get_client()
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] Cleanup de intervenciones\n")

    to_delete: list[str] = []
    for name, day in TARGETS:
        print(f"→ {name} ({day.isoformat()})")
        account_id = _find_account_id(client, name)
        if not account_id:
            continue

        rows = _find_interventions(client, account_id, day)
        if not rows:
            print("  [skip] No hay intervenciones para esa cuenta en esa fecha")
            continue

        for row in rows:
            print(
                f"  · id={row['id']} status={row['status']} "
                f"channel={row['channel']} created_at={row['created_at']}"
            )
            to_delete.append(row["id"])

    if not to_delete:
        print("\nNada para borrar. Listo.")
        return 0

    print(f"\nTotal a borrar: {len(to_delete)} fila(s)")

    if not args.apply:
        print("Dry-run: pasa --apply para ejecutar el DELETE.")
        return 0

    res = client.table("interventions").delete().in_("id", to_delete).execute()
    deleted = len(res.data or [])
    print(f"DELETE ejecutado. Filas borradas reportadas por Supabase: {deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
