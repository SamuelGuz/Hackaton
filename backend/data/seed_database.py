"""CLI: reset (delete) and bulk-insert synthetic seed data into Supabase."""

from __future__ import annotations

import argparse
import logging
import re
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

APPEND_SAFE_TABLES: tuple[str, ...] = (
    "accounts",
    "usage_events",
    "tickets",
    "conversations",
    "nps_responses",
    "account_health_history",
    "account_health_snapshot",
)


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
        assert a.get("account_number")


def count_rows(client: Any, table: str, pk_field: str = "id") -> int:
    try:
        r = (
            client.table(table)
            .select(pk_field, count="exact")  # type: ignore[arg-type]
            .limit(1)
            .execute()
        )
        c = getattr(r, "count", None)
        if c is None:
            return len(r.data or [])
        return int(c)
    except Exception:
        return 0


def fetch_account_names(client: Any) -> set[str]:
    """Fetch existing account names to avoid duplicates in append mode."""
    try:
        r = client.table("accounts").select("name").execute()
        data = r.data or []
        return {
            str(row.get("name")).strip()
            for row in data
            if isinstance(row, dict) and row.get("name")
        }
    except Exception:
        return set()


def fetch_account_numbers(client: Any) -> set[str]:
    """Fetch existing account numbers to avoid duplicates in append mode."""
    try:
        r = client.table("accounts").select("account_number").execute()
        data = r.data or []
        return {
            str(row.get("account_number")).strip()
            for row in data
            if isinstance(row, dict) and row.get("account_number")
        }
    except Exception:
        return set()


def _extract_numeric_suffix(account_number: str) -> int | None:
    m = re.match(r"^ACC-\d{4}-(\d+)$", account_number)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def max_account_number_suffix(account_numbers: set[str]) -> int:
    mx = 0
    for value in account_numbers:
        parsed = _extract_numeric_suffix(value)
        if parsed is not None and parsed > mx:
            mx = parsed
    return mx


def dedupe_account_names(accounts: list[dict[str, Any]], existing_names: set[str]) -> int:
    """
    Ensure account names are unique against existing rows and within the current batch.
    Returns number of renamed rows.
    """
    used = {n for n in existing_names if n}
    renamed = 0
    for idx, row in enumerate(accounts, start=1):
        base_name = str(row.get("name") or "").strip() or f"Generated Account {idx}"
        candidate = base_name
        suffix = 2
        while candidate in used:
            candidate = f"{base_name} ({suffix})"
            suffix += 1
        if candidate != base_name:
            row["name"] = candidate
            renamed += 1
        used.add(candidate)
    return renamed


def renumber_account_numbers(accounts: list[dict[str, Any]], *, start_suffix: int) -> None:
    """
    Assign sequential account_number values compatible with CONTRACTS format:
    ACC-YYYY-NNNNN
    """
    for idx, row in enumerate(accounts):
        signup_raw = str(row.get("signup_date") or "")
        year = signup_raw[:4] if len(signup_raw) >= 4 and signup_raw[:4].isdigit() else "2026"
        row["account_number"] = f"ACC-{year}-{start_suffix + idx:05d}"


def run_seed(
    cfg: GeneratorConfig,
    *,
    do_reset: bool,
    only: set[str] | None,
    append_mode: bool,
) -> None:
    client = get_client()
    if do_reset and append_mode:
        raise ValueError("--append and --reset are mutually exclusive.")

    existing_account_names: set[str] = set()
    existing_account_numbers: set[str] = set()
    max_suffix = 0
    if append_mode and only is None:
        only = set(APPEND_SAFE_TABLES)
        print("Append mode enabled: inserting only append-safe tables by default.")

    if append_mode and only and "accounts" in only:
        csm_count = count_rows(client, "csm_team")
        if csm_count == 0:
            raise RuntimeError(
                "Append mode needs existing csm_team rows (accounts.csm_id FK). "
                "Run a full seed first or include csm_team explicitly."
            )
        existing_accounts = count_rows(client, "accounts")
        existing_account_names = fetch_account_names(client)
        existing_account_numbers = fetch_account_numbers(client)
        max_suffix = max_account_number_suffix(existing_account_numbers)
        # Prevent deterministic collisions when running append repeatedly with the same --seed.
        cfg.random_seed = cfg.random_seed + existing_accounts
        print(
            f"Append mode: detected {existing_accounts} existing accounts; "
            f"using effective seed={cfg.random_seed}."
        )

    if do_reset:
        reset_tables(client)

    ds = build_dataset(cfg)
    if append_mode and only and "accounts" in only:
        renamed = dedupe_account_names(ds.accounts, existing_account_names)
        if renamed:
            print(f"Append mode: renamed {renamed} generated account names to avoid duplicates.")
        renumber_account_numbers(ds.accounts, start_suffix=max_suffix + 1)
        print(
            "Append mode: reassigned account_number values "
            f"starting at suffix {max_suffix + 1} to avoid unique collisions."
        )
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
            c = count_rows(client, t)
            print(f"Count {t}: {c}")
        except Exception as e:
            print(f"Count {t} failed: {e}")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    p = argparse.ArgumentParser(description="Seed Supabase with synthetic demo data.")
    p.add_argument("--reset", action="store_true", help="Delete seed tables before insert")
    p.add_argument("--only", type=str, default="", help="Comma tables e.g. accounts,usage_events")
    p.add_argument(
        "--append",
        action="store_true",
        help=(
            "Append new generated rows without deleting existing dataset. "
            "If --only is omitted, inserts only append-safe tables "
            "(accounts + dependent tables)."
        ),
    )
    p.add_argument("--accounts", type=int, default=200, dest="num_accounts")
    p.add_argument("--skip-claude", action="store_true")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--monte-carlo",
        action="store_true",
        help="Monte Carlo mode: log-normal ARR/seats, Poisson usage_events, Gaussian random walk health scores",
    )
    args = p.parse_args()

    only = {x.strip() for x in args.only.split(",") if x.strip()} if args.only else None

    cfg = GeneratorConfig(
        num_accounts=args.num_accounts,
        skip_claude=args.skip_claude,
        random_seed=args.seed,
        monte_carlo=args.monte_carlo,
    )
    run_seed(
        cfg,
        do_reset=args.reset,
        only=only,
        append_mode=args.append,
    )


if __name__ == "__main__":
    main()
