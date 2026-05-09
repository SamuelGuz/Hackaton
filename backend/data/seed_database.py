"""CLI: reset (delete) and bulk-insert synthetic seed data into Supabase."""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

# Repo root on sys.path when running as `python -m backend.data.seed_database`
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv

load_dotenv(_ROOT / ".env")

from backend.data.synthetic_generator import GeneratedDataset, GeneratorConfig, build_dataset
from backend.shared.supabase_client import get_client


def _chunks(rows: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def insert_table(client: Any, table: str, rows: list[dict[str, Any]], *, chunk: int = 250) -> None:
    if not rows:
        print(f"  skip {table} (0 rows)")
        return
    for batch in _chunks(rows, chunk):
        client.table(table).insert(batch).execute()
    print(f"  inserted {len(rows)} -> {table}")


def reset_tables(client: Any) -> None:
    """Delete rows in FK-safe order (PostgREST)."""
    tables_child_first = [
        "interventions",
        "account_health_history",
        "account_health_snapshot",
        "nps_responses",
        "conversations",
        "tickets",
        "usage_events",
        "accounts",
        "playbook_memory",
        "historical_deals",
        "system_settings",
        "csm_team",
    ]
    sentinel = "00000000-0000-0000-0000-000000000000"
    print("Reset: deleting existing rows...")
    for t in tables_child_first:
        try:
            if t == "system_settings":
                client.table(t).delete().neq("key", "").execute()
            elif t == "account_health_snapshot":
                client.table(t).delete().neq("account_id", sentinel).execute()
            else:
                client.table(t).delete().neq("id", sentinel).execute()
        except Exception as e:
            print(f"  warning: could not delete {t}: {e}")
    print("Reset done.")


def validate_dataset(ds: GeneratedDataset, expected_accounts: int, expected_deals: int = 50) -> None:
    assert len(ds.accounts) == expected_accounts, f"accounts {len(ds.accounts)} != {expected_accounts}"
    assert len(ds.playbook_memory) == 12
    assert len(ds.historical_deals) == expected_deals, f"historical_deals {len(ds.historical_deals)} != {expected_deals}"
    bc = Counter(s.bucket for s in ds.seeds_meta)
    print("Bucket distribution:", dict(bc))
    traps_c = sum(1 for s in ds.seeds_meta if s.is_demo_trap_churn)
    traps_e = sum(1 for s in ds.seeds_meta if s.is_demo_trap_expansion)
    print(f"Demo traps: churn_subtle={traps_c}, expansion_subtle={traps_e}")
    for a in ds.accounts[:3]:
        assert a.get("current_nps_score") is not None


def run_seed(cfg: GeneratorConfig, *, do_reset: bool, only: set[str] | None) -> None:
    client = get_client()
    if do_reset:
        reset_tables(client)

    ds = build_dataset(cfg)
    validate_dataset(ds, cfg.num_accounts, cfg.historical_deals_n)

    def want(name: str) -> bool:
        return only is None or name in only

    if want("csm_team"):
        insert_table(client, "csm_team", ds.csm_team)
    if want("system_settings"):
        insert_table(client, "system_settings", ds.system_settings)
    if want("accounts"):
        insert_table(client, "accounts", ds.accounts)
    if want("usage_events"):
        insert_table(client, "usage_events", ds.usage_events, chunk=500)
    if want("tickets"):
        insert_table(client, "tickets", ds.tickets)
    if want("conversations"):
        insert_table(client, "conversations", ds.conversations)
    if want("nps_responses"):
        insert_table(client, "nps_responses", ds.nps_responses)
    if want("historical_deals"):
        insert_table(client, "historical_deals", ds.historical_deals)
    if want("playbook_memory"):
        insert_table(client, "playbook_memory", ds.playbook_memory)
    if want("account_health_history"):
        insert_table(client, "account_health_history", ds.account_health_history, chunk=400)
    if want("account_health_snapshot"):
        insert_table(client, "account_health_snapshot", ds.account_health_snapshot)

    # Post-insert counts
    for t in ("accounts", "usage_events", "tickets", "conversations", "nps_responses"):
        try:
            r = (
                client.table(t)
                .select("id", count="exact")  # type: ignore[arg-type]
                .limit(1)
                .execute()
            )
            c = getattr(r, "count", None)
            if c is None:
                c = len(r.data or [])
            print(f"Count {t}: {c}")
        except Exception as e:
            print(f"Count {t} failed: {e}")


def main() -> None:
    p = argparse.ArgumentParser(description="Seed Supabase with synthetic demo data.")
    p.add_argument("--reset", action="store_true", help="Delete seed tables before insert")
    p.add_argument("--only", type=str, default="", help="Comma tables e.g. accounts,usage_events")
    p.add_argument("--accounts", type=int, default=200, dest="num_accounts")
    p.add_argument("--skip-claude", action="store_true")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    only = {x.strip() for x in args.only.split(",") if x.strip()} if args.only else None

    cfg = GeneratorConfig(
        num_accounts=args.num_accounts,
        skip_claude=args.skip_claude,
        random_seed=args.seed,
    )
    run_seed(cfg, do_reset=args.reset, only=only)


if __name__ == "__main__":
    main()
