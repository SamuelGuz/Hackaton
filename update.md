# Churn Oracle — Codebase Status

> Snapshot of what exists, how it runs, and what still missing.

---

## 1. What Already Built

### Backend — FastAPI (`backend/`)

#### Entrypoint
- [`main.py`](backend/main.py) — app, CORS, exception handlers, `/health`, `/api/v1/__diag/probe`. Mounts 6 routers under `/api/v1`.

#### Routes
| Router | Prefix | Endpoints |
|--------|--------|-----------|
| `accounts_import` | `/accounts` | `POST /import`, `POST /import/file`, `POST /import/usage-events[/file]`, `POST /import/tickets[/file]`, `POST /import/conversations[/file]` |
| `accounts` | `/accounts` | `POST ""`, `GET ""`, `GET /health-history`, `GET /{id}`, `GET /{id}/timeline`, `GET /{id}/health-history` |
| `agents` | `/agents` | `POST /crystal-ball/{account_id}`, `POST /expansion/{account_id}`, `POST /intervention/{account_id}` |
| `dispatch` | (root) | `POST /dispatch-intervention` |
| `interventions` | `/interventions` | `GET ""`, `POST /{intervention_id}/outcome` |
| `playbooks` | `/playbooks` | `GET ""`, `GET /{playbook_id}/history` |

#### Agents (`backend/agents/`)
- **`crystal_ball.py`** — autonomous tool-loop, churn risk score 0-100, max 10 turns, 24h cache. UPSERT `account_health_snapshot` + INSERT `account_health_history`.
- **`expansion.py`** — same pattern, expansion score + recommended plan + upsell message draft. Shares snapshot row with Crystal Ball.
- **`intervention_engine.py`** — `run_intervention(account_id, trigger_reason)`. Checks 72h cool-off, loads recent interventions, picks channel deterministically, LLM drafts message, persists to `interventions` table. Raises `AccountNotFound` / `SnapshotMissing` / `CoolOffActive` / `InvalidOutputError`.
- **`learning_loop.py`** — present (closed-loop refinement, scope to verify).
- **`tools.py`** — `TOOLS_SPEC` + `EXPANSION_TOOLS_SPEC` + `TOOL_DISPATCH`. Tools: `get_account_details`, `get_usage_events`, `get_tickets`, `get_conversations`, `analyze_sentiment_batch`, `summarize_text`, `search_similar_historical_deals`, `get_seat_utilization`, `get_feature_adoption`, `submit_final_analysis`.

#### Shared (`backend/shared/`)
- **`llm_client.py`** — unified facade. Picks Anthropic or OpenAI via `LLM_PROVIDER` env var (default `anthropic`). Models from `CLAUDE_SONNET_MODEL`/`CLAUDE_HAIKU_MODEL` or `OPENAI_QUALITY_MODEL`/`OPENAI_FAST_MODEL`. Tenacity retry, JSON extraction.
- **`claude_client.py`** — thin wrapper over `llm_client.py`.
- **`openai_client.py`** — direct OpenAI singleton (`gpt-4o` / `gpt-4o-mini`), `complete_with_tools` + `complete_simple`.
- **`supabase_client.py`** — lazy Supabase singleton.
- **`api_auth.py`** — single API key middleware (demo auth).

#### Automations (`backend/automations/`)
- **`channel_router.py`** — picks channel (email/slack/whatsapp/voice_call) per account+intervention; orchestrates dispatch.
- **`make_webhooks.py`** — fires Make webhooks: `send_email` (`MAKE_WEBHOOK_EMAIL`), `send_slack` (`MAKE_WEBHOOK_SLACK`), `send_whatsapp` (`MAKE_WEBHOOK_WHATSAPP`).
- **`slack_notifier.py`** — fire-and-forget CSM Slack notice every time intervention created (uses same Make Slack webhook).
- **`elevenlabs_client.py`** — ElevenLabs Conversational AI signed-URL fetch for voice calls.

#### Data layer (`backend/data/`)
- `schemas.py` — pydantic models.
- `synthetic_generator.py` + `seed_database.py` — bootstrap demo data.
- `generators/` — per-table fakers: accounts, usage_events, tickets, conversations, csm_team, playbooks, historical_deals, nps_responses, health_history.
- `prompts/` — LLM prompt templates for synthetic ticket/conversation/historical-deal/nps generation.

#### Tests
- `backend/tests/smoke_agents.py` — smoke for crystal_ball / expansion / intervention.

### Frontend — React + Vite + Tailwind (`frontend/`)
- Pages: `Dashboard`, `AccountDetail`, `Interventions`, `ClosedLoop`, `Upload`.
- Components: `RiskBadge`, `ScoreBar`, `Sparkline`, `Timeline`, `InterventionModal`, `VoiceCallPanel`, `PlaybookRow`, `PlaybookEvolutionCard`, `HealthHistoryTable`, `ChannelIcon`, etc.
- `api/` client, `context/`, `hooks/`, `i18n/`, `mocks/`.

### Infra
- `backend/Dockerfile` present.
- `.github/workflows/` Docker build+push pipeline.
- Supabase as DB.
- Make as automation hub (3 webhooks: email/slack/whatsapp).
- ElevenLabs for voice.

---

## 2. How It Works Right Now

### Read path (analyze account)
1. Frontend → `POST /api/v1/agents/crystal-ball/{id}` (or `/expansion/{id}`).
2. Route checks account exists → calls `run_crystal_ball()`.
3. Cache hit? Return snapshot. Else loop:
   - LLM (Sonnet via `llm_client`, OpenAI fallback) given system prompt + `TOOLS_SPEC`.
   - Each turn: model picks tools → `TOOL_DISPATCH` runs Supabase queries / Haiku helpers → results fed back.
   - Terminates on `submit_final_analysis` tool call → pydantic-validated → UPSERT snapshot + INSERT history.
4. Response returned to frontend.

### Action path (intervention)
1. Trigger: `POST /api/v1/agents/intervention/{id}` body `{trigger_reason}`.
2. `run_intervention()`:
   - Load snapshot (409 if missing) + account + last 3 interventions.
   - 72h cool-off check (409 if active).
   - Channel router picks channel deterministically.
   - LLM drafts message (subject + body) referencing playbook + signals.
   - Pydantic validate → insert `interventions` row (status=`pending`).
3. Background task: `slack_notifier.notify_csm()` posts to CSM Slack via Make webhook.
4. CSM approves → `POST /dispatch-intervention {intervention_id}`:
   - Load intervention, verify status pending/approved.
   - Fire Make webhook for channel (email or whatsapp).
   - Mark `sent` / `failed`.
5. Outcome later: `POST /interventions/{id}/outcome` updates result; feeds learning loop.

### Data flow
- Single Supabase Postgres. Tables include `accounts`, `usage_events`, `tickets`, `conversations`, `historical_deals`, `account_health_snapshot` (one row per account, owned jointly by CB + Expansion), `account_health_history` (append-only), `interventions`, `playbooks`, `csm_team`, `nps_responses`.

---

## 3. Infrastructure Diagram

```
                               ┌───────────────────────────────┐
                               │  Frontend (React+Vite)        │
                               │  Dashboard / AccountDetail /  │
                               │  Interventions / ClosedLoop / │
                               │  Upload                       │
                               └─────────────┬─────────────────┘
                                             │  /api/v1/*
                                             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                       FastAPI (backend/main.py)                            │
│  /accounts  /accounts/import  /agents  /interventions  /playbooks          │
│  /dispatch-intervention   /health   /__diag/probe                          │
└──┬─────────────┬──────────────────┬──────────────────┬─────────────────────┘
   │             │                  │                  │
   ▼             ▼                  ▼                  ▼
┌─────────┐  ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────┐
│ accounts│  │  AGENT LAYER     │ │ INTERVENTIONS    │ │ PLAYBOOKS       │
│ CRUD +  │  │ crystal_ball     │ │ list / outcome   │ │ list / history  │
│ import  │  │ expansion        │ │                  │ │                 │
│         │  │ intervention_eng │ │                  │ │                 │
│         │  │ learning_loop    │ │                  │ │                 │
└────┬────┘  └────────┬─────────┘ └────────┬─────────┘ └────────┬────────┘
     │                │                    │                    │
     │       ┌────────┴─────────┐          │                    │
     │       ▼                  ▼          │                    │
     │  ┌─────────┐      ┌─────────────┐   │                    │
     │  │ tools.py│      │ shared/     │   │                    │
     │  │ TOOL_   │      │ llm_client  │   │                    │
     │  │ DISPATCH│      │ (Anthropic /│   │                    │
     │  └────┬────┘      │  OpenAI)    │   │                    │
     │       │           └──────┬──────┘   │                    │
     │       │                  │          │                    │
     │       │                  ▼          │                    │
     │       │       ┌─────────────────┐   │                    │
     │       │       │ Anthropic API   │   │                    │
     │       │       │ Sonnet + Haiku  │   │                    │
     │       │       │  OR OpenAI      │   │                    │
     │       │       │ gpt-4o + mini   │   │                    │
     │       │       └─────────────────┘   │                    │
     │       │                             │                    │
     ▼       ▼                             ▼                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Supabase Postgres                              │
│  accounts · usage_events · tickets · conversations · historical_deals  │
│  account_health_snapshot · account_health_history                      │
│  interventions · playbooks · csm_team · nps_responses                  │
└────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ background dispatch
                                  │
            ┌─────────────────────┴────────────────────────┐
            ▼                                              ▼
   ┌────────────────────┐                    ┌──────────────────────────┐
   │ automations/       │                    │ slack_notifier           │
   │  channel_router    │                    │ (CSM approval ping)      │
   │  make_webhooks     │                    └────────────┬─────────────┘
   │  elevenlabs_client │                                 │
   └──────────┬─────────┘                                 │
              │                                           │
              ▼                                           ▼
   ┌──────────────────────────────────────┐   ┌──────────────────────┐
   │ Make.com webhooks                    │   │ Make Slack webhook   │
   │  MAKE_WEBHOOK_EMAIL                  │   └──────────┬───────────┘
   │  MAKE_WEBHOOK_SLACK                  │              │
   │  MAKE_WEBHOOK_WHATSAPP               │              ▼
   └──────────┬─────────────┬─────────────┘   ┌──────────────────────┐
              │             │                 │ CSM Slack channel    │
              ▼             ▼                 └──────────────────────┘
        ┌─────────┐   ┌──────────┐
        │ Email   │   │ WhatsApp │      ┌──────────────────────┐
        │ provider│   │ provider │      │ ElevenLabs ConvAI    │
        └─────────┘   └──────────┘      │ (voice signed URL)   │
                                        └──────────────────────┘
```

---

## 4. What's Left / Open Items

### Unverified / partial
- **`learning_loop.py`** — file exists; closed-loop refinement logic needs review + wiring to a route. No `/playbooks/refine` style endpoint mounted.
- **Intervention outcome → playbook update** — `POST /interventions/{id}/outcome` exists but feedback path into `playbooks` table not confirmed.
- **Voice channel dispatch** — `elevenlabs_client.get_convai_signed_url` present; end-to-end voice flow (FastAPI generates audio → Make → call) needs verification per `claude.md` rule (audio generated in FastAPI before Make).

### Missing / TODO
- **Auth hardening** — `api_auth.py` is single key for demo; OK per spec (not multi-tenant).
- **Tests** — only smoke tests; no per-route unit/integration coverage for accounts, dispatch, interventions, playbooks.
- **CI** — Docker pipeline exists; no test run gate.
- **Frontend ↔ backend contract** — verify camelCase ↔ snake_case at api client boundary per `claude.md`.
- **Playbook seeding** — confirm `playbooks` table has demo rows usable by intervention engine.
- **Cool-off / cache constants surfaced as env** — currently hardcoded (24h cache, 72h cool-off).
- **Observability** — no structured logging spec, no metrics endpoint beyond `/health`.

### Spec deviations to flag
- Two LLM client paths coexist (`llm_client.py` unified vs direct `openai_client.py`). Decide canonical and remove dead path.
- `claude.md` says "never call LLM from frontend" — verify no frontend mock/dev stub bypasses this.
