"""Orchestrate synthetic dataset generation (CONTRACTS.md §4)."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tqdm import tqdm

from backend.data.generators.accounts import AccountSeed, build_account_seeds
from backend.data.generators.conversations import generate_conversations_for_account
from backend.data.generators.csm_team import build_csm_team_rows
from backend.data.generators.health_history import build_health_history_and_snapshot
from backend.data.generators.historical_deals import generate_historical_deals
from backend.data.generators.nps_responses import generate_nps_for_accounts
from backend.data.generators.playbooks import build_playbook_memory_rows
from backend.data.generators.settings import build_system_settings_rows
from backend.data.generators.tickets import generate_tickets_for_account
from backend.data.generators.usage_events import generate_usage_events
from backend.shared.claude_client import ClaudeClient, get_claude_client, haiku_model, sonnet_model


@dataclass
class GeneratorConfig:
    num_accounts: int = 200
    skip_claude: bool = False
    random_seed: int = 42
    cache_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent / "_cache")
    historical_deals_n: int = 50
    monte_carlo: bool = False


@dataclass
class GeneratedDataset:
    csm_team: list[dict[str, Any]]
    system_settings: list[dict[str, Any]]
    accounts: list[dict[str, Any]]
    usage_events: list[dict[str, Any]]
    tickets: list[dict[str, Any]]
    conversations: list[dict[str, Any]]
    nps_responses: list[dict[str, Any]]
    historical_deals: list[dict[str, Any]]
    playbook_memory: list[dict[str, Any]]
    account_health_history: list[dict[str, Any]]
    account_health_snapshot: list[dict[str, Any]]
    seeds_meta: list[AccountSeed] = field(default_factory=list)


def _csm_name_lookup(csm_rows: list[dict[str, Any]]) -> dict[str, str]:
    return {str(r["id"]): str(r["name"]).split()[0] for r in csm_rows}


def build_dataset(cfg: GeneratorConfig) -> GeneratedDataset:
    cfg.cache_dir.mkdir(parents=True, exist_ok=True)
    rng_master = random.Random(cfg.random_seed)

    csm_team = build_csm_team_rows()
    system_settings = build_system_settings_rows()
    seeds = build_account_seeds(
        cfg.num_accounts,
        csm_team,
        faker_seed=cfg.random_seed,
        monte_carlo=cfg.monte_carlo,
    )

    claude: ClaudeClient | None
    try:
        claude = None if cfg.skip_claude else get_claude_client()
    except Exception:
        claude = None

    nps_rows = generate_nps_for_accounts(seeds, rng_master, claude, cfg.skip_claude)

    csm_first = _csm_name_lookup(csm_team)

    usage_events: list[dict[str, Any]] = []
    tickets: list[dict[str, Any]] = []
    conversations: list[dict[str, Any]] = []
    account_health_history: list[dict[str, Any]] = []
    account_health_snapshot: list[dict[str, Any]] = []

    for i, seed in enumerate(tqdm(seeds, desc="Per-account synthetic")):
        rng = random.Random(cfg.random_seed + i * 7919)
        n_events = rng.randint(100, 300)
        usage_events.extend(
            generate_usage_events(
                seed.id,
                seed.bucket,
                rng=rng,
                count=n_events,
                monte_carlo=cfg.monte_carlo,
            )
        )
        cache_t = cfg.cache_dir / f"{seed.id}_tickets.json"
        cache_c = cfg.cache_dir / f"{seed.id}_conversations.json"
        csm_n = csm_first.get(str(seed.row["csm_id"]), "CSM")

        tickets.extend(
            generate_tickets_for_account(
                account_id=seed.id,
                company_name=str(seed.row["name"]),
                industry=str(seed.row["industry"]),
                bucket=seed.bucket,
                rng=rng,
                claude=claude,
                skip_claude=cfg.skip_claude,
                cache_path=cache_t,
                model=haiku_model(),
            )
        )
        conversations.extend(
            generate_conversations_for_account(
                account_id=seed.id,
                company_name=str(seed.row["name"]),
                csm_first_name=csm_n,
                bucket=seed.bucket,
                rng=rng,
                claude=claude,
                skip_claude=cfg.skip_claude,
                cache_path=cache_c,
                model=haiku_model(),
            )
        )
        hist, snap = build_health_history_and_snapshot(seed, rng, monte_carlo=cfg.monte_carlo)
        account_health_history.extend(hist)
        account_health_snapshot.append(snap)

    historical_deals = generate_historical_deals(
        n=cfg.historical_deals_n,
        rng=rng_master,
        claude=claude,
        skip_claude=cfg.skip_claude,
        cache_dir=cfg.cache_dir,
        model=sonnet_model(),
    )
    playbook_memory = build_playbook_memory_rows()

    accounts = [s.row for s in seeds]

    return GeneratedDataset(
        csm_team=csm_team,
        system_settings=system_settings,
        accounts=accounts,
        usage_events=usage_events,
        tickets=tickets,
        conversations=conversations,
        nps_responses=nps_rows,
        historical_deals=historical_deals,
        playbook_memory=playbook_memory,
        account_health_history=account_health_history,
        account_health_snapshot=account_health_snapshot,
        seeds_meta=seeds,
    )
