# Churn Oracle — Codebase Status

> Snapshot of what exists, how it runs, and what still missing.
> **Updated 2026-05-10:** closed-loop fully wired. System self-improves end-to-end.

---

## 1. What's Built

### Backend — FastAPI (`backend/`)

#### Entrypoint
- [`main.py`](backend/main.py) — app, CORS, exception handlers, `/health`, `/api/v1/__diag/probe`. Mounts 6 routers under `/api/v1`.

#### Routes
| Router | Prefix | Endpoints |
|--------|--------|-----------|
| `accounts_import` | `/accounts` | `POST /import`, `POST /import/file`, `POST /import/usage-events[/file]`, `POST /import/tickets[/file]`, `POST /import/conversations[/file]` |
| `accounts` | `/accounts` | `POST ""`, `GET ""`, `GET /health-history`, `GET /{id}`, `GET /{id}/timeline`, `GET /{id}/health-history` |
| `agents` | `/agents` | `POST /crystal-ball/{account_id}`, `POST /expansion/{account_id}`, `POST /intervention/{account_id}`, **`POST /batch-process`**, **`GET /batch-process/{batch_id}`** |
| `dispatch` | (root) | `POST /dispatch-intervention`, `POST /dispatch-intervention/callback`, `POST /dispatch-intervention/conversation`, `GET /dispatch-intervention/status/{id}` |
| `interventions` | `/interventions` | `GET ""`, `POST /{intervention_id}/outcome` |
| `playbooks` | `/playbooks` | `GET ""`, `GET /{playbook_id}/history` |

#### Agents (`backend/agents/`)
- **`crystal_ball.py`** — autonomous tool-loop, churn risk score 0-100, max 10 turns, 24h cache (rejects rows with null `crystal_ball_confidence`/`reasoning` so seed data forces re-run). UPSERT `account_health_snapshot` + INSERT `account_health_history`. `health_status` mapping: 0-39 healthy, 40-59 stable, 60-79 at_risk, 80-100 critical.
- **`expansion.py`** — same pattern, expansion score 0-100 + recommended plan + upsell message draft. Shares snapshot row with Crystal Ball without clobbering its fields. `health_status='expanding'` only flipped from `stable`/`healthy`.
- **`intervention_engine.py`** — `run_intervention(account_id, trigger_reason)`. Single-shot LLM (gpt-4o, temp 0.4). Deterministic Python channel ladder: rule 1 playbook override (`success_rate≥0.70 AND times_used≥5`), rule 2 repeat-channel guard, rules 3-10 ARR + health + trigger. Cool-off 72h same-account + 14-day same-playbook. Recipient auto-downgrades if missing field. Approval rule (Python): `voice_call|whatsapp` OR `arr>25k` OR `confidence<0.75` OR (`churn_risk_high AND arr>50k`). Status resolved against `system_settings.auto_approval_*`. Per-account threading.Lock + idempotency check on POST. Channel intent split: **email = SOLUTION mode** (hypothesis + offer + closeable y/n), **whatsapp/voice = DISCOVERY mode** (open question, no solution).
- **`learning_loop.py`** — `regenerate_playbook_if_failing(playbook_id)`. Trigger: `success_rate<0.30 AND times_used>=5 AND superseded_by IS NULL`. LLM (gpt-4o, temp 0.6) reads dying playbook + last 8 interventions + outcomes; generates v+1 with channel switch / tone shift / framing change. Inserts new row (version=N+1, fresh stats) + sets `superseded_by` on old. Engine's `_select_top_playbooks` filters `superseded_by IS NULL`.
- **`batch_processor.py`** — `submit_batch(limit, trigger_reason)` + `get_batch_status(batch_id)`. ThreadPoolExecutor(max_workers=4) — 4 accounts truly parallel, per-account CB→Expansion→Intervention sequential. Module state dict + threading.Lock. `CoolOffActive` on intervention → step=skipped (account still completes). Polled via GET endpoint.
- **`tools.py`** — `TOOLS_SPEC` + `EXPANSION_TOOLS_SPEC` + `TOOL_DISPATCH`. Tools: `get_account_details`, `get_usage_events`, `get_tickets`, `get_conversations`, `analyze_sentiment_batch`, `summarize_text`, `search_similar_historical_deals`, `get_seat_utilization`, `get_feature_adoption`, `submit_final_analysis`.

#### Shared (`backend/shared/`)
- **`llm_client.py`** — unified facade. Picks Anthropic or OpenAI via `LLM_PROVIDER` env (default `anthropic`). Models from `CLAUDE_SONNET_MODEL`/`CLAUDE_HAIKU_MODEL` or `OPENAI_QUALITY_MODEL`/`OPENAI_FAST_MODEL`. Tenacity retry, JSON extraction.
- **`claude_client.py`** — thin wrapper.
- **`openai_client.py`** — direct OpenAI singleton (`gpt-4o` / `gpt-4o-mini`), `complete_with_tools` + `complete_simple`. Used by Persona-2 agents directly.
- **`supabase_client.py`** — lazy Supabase singleton + `get_client()` alias.
- **`api_auth.py`** — single API key middleware (demo auth).

#### Automations (`backend/automations/`)
- **`channel_router.py`** — owns `POST /api/v1/dispatch-intervention`. Routes to email / slack / whatsapp / voice via Make. Voice path generates ElevenLabs audio → uploads to Supabase Storage → passes `audio_url` + `fallback_text`. Inbound `/conversation` webhook: LLM-classifies client reply, infers outcome, writes `conversations` + intervention `outcome`, calls `_apply_playbook_outcome` (which now also triggers `regenerate_playbook_if_failing`).
- **`make_webhooks.py`** — `send_email`, `send_slack`, `send_whatsapp`, `send_voice`. Outgoing payloads:
  - Email: `{intervention_id, to, to_name, subject, body, account_id, account_name}`
  - WhatsApp: `{intervention_id, to_phone, to_name, message, account_id, account_name}`
  - Slack (CSM notify): structured payload below
  - Voice: `{intervention_id, to_phone, audio_url, fallback_text, callback_url}`
- **`slack_notifier.py`** — fire-and-forget CSM notice on every intervention via FastAPI `BackgroundTasks` (post-response, never blocks). Reuses `MAKE_WEBHOOK_SLACK`. Payload:
  ```
  intervention_id, account_id, account_name, status, auto_approved,
  channel, recipient, trigger_reason, confidence,
  playbook_id, playbook_success_rate, approval_reasoning, agent_reasoning,
  account_arr, account_industry, account_plan, slack_message_markdown
  ```
  Make scenario branches on `auto_approved/status` to render simple notice vs Block Kit with Approve/Reject buttons.
- **`elevenlabs_client.py`** — text-to-speech + ConvAI signed-URL fetch.

#### Data layer (`backend/data/`)
- `schemas.py`, `synthetic_generator.py`, `seed_database.py`, `generators/` per-table fakers, `prompts/` LLM templates.

#### Tests
- `backend/tests/smoke_agents.py` — smoke for crystal_ball / expansion / intervention.

### Frontend — React + Vite + Tailwind (`frontend/`)
- Pages: `Dashboard`, `AccountDetail`, `Interventions`, `ClosedLoop`, `Upload`.
- Components: `RiskBadge`, `ScoreBar`, `Sparkline`, `Timeline`, `InterventionModal`, `VoiceCallPanel`, `PlaybookRow`, `PlaybookEvolutionCard`, `HealthHistoryTable`, `ChannelIcon`, etc.
- `api/` client, `context/`, `hooks/`, `i18n/`, `mocks/`.

### Infra
- `backend/Dockerfile` — Python 3.11-slim, `--reload` mounted, port 8000.
- `docker-compose.yml` — single `backend` service, env_file `.env`, volume mount `./backend:/app/backend`.
- `.github/workflows/` — Docker build+push.
- Supabase Postgres.
- Make.com — 4 scenarios (email / slack / whatsapp / voice).
- ElevenLabs — voice cloning + ConvAI.

---

## 2. End-to-End Pipeline

### Per-account
```
POST /api/v1/agents/crystal-ball/{id}    →  score + signals
POST /api/v1/agents/expansion/{id}        →  expansion score + plan
POST /api/v1/agents/intervention/{id}     →  draft + persisted intervention (status pending|pending_approval)
                                              ↓
                                          BackgroundTasks → notify_csm → MAKE_WEBHOOK_SLACK
                                              ↓
[CSM approves manually OR auto-approval rule fires]
                                              ↓
POST /api/v1/dispatch-intervention        →  Make webhook fires → email/whatsapp/voice goes out
                                              ↓
[Customer replies — Make catches reply → POST /api/v1/dispatch-intervention/conversation]
                                              ↓
LLM classifies reply → infers outcome → updates intervention + playbook stats
                                              ↓
regenerate_playbook_if_failing()  → if rate<0.30 AND uses≥5: LLM generates v+1, marks v1 superseded
                                              ↓
[Engine's next decision uses v+1 — closed loop]
```

### Batch (4 newest accounts)
```
POST /api/v1/agents/batch-process {"limit":4,"trigger_reason":"churn_risk_high"}
   → 202 with batch_id
   → ThreadPoolExecutor(max_workers=4)
   → 4 parallel workers, each runs CB → Expansion → Intervention sequentially
   → ~21s end-to-end vs ~120s sequential

GET /api/v1/agents/batch-process/{batch_id}   → poll status
```

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
└──┬──────┬──────────────────┬──────────────────┬──────────────────┬─────────┘
   │      │                  │                  │                  │
   ▼      ▼                  ▼                  ▼                  ▼
┌────────┐ ┌──────────────────┐ ┌────────────────────┐ ┌──────────────────┐
│ accts  │ │  AGENT LAYER     │ │ INTERVENTIONS      │ │ PLAYBOOKS        │
│ CRUD + │ │ crystal_ball     │ │ list / outcome     │ │ list / history   │
│ import │ │ expansion        │ │  ↓                 │ │                  │
│        │ │ intervention_eng │ │  learning_loop.py  │ │                  │
│        │ │ batch_processor  │ │  (regen v+1)       │ │                  │
│        │ │ learning_loop    │ │                    │ │                  │
│        │ └────────┬─────────┘ └─────────┬──────────┘ └─────────┬────────┘
│        │          │                     │                       │
│        │   ┌──────┴──────┐              │                       │
│        │   ▼             ▼              │                       │
│        │  ┌─────────┐  ┌─────────────┐  │                       │
│        │  │ tools.py│  │ shared/     │  │                       │
│        │  │ TOOL_   │  │ llm_client  │  │                       │
│        │  │ DISPATCH│  │ openai_client│ │                       │
│        │  └────┬────┘  └──────┬──────┘  │                       │
│        │       │              │         │                       │
│        │       │              ▼         │                       │
│        │       │   ┌─────────────────┐  │                       │
│        │       │   │ OpenAI / Anthr. │  │                       │
│        │       │   └─────────────────┘  │                       │
│        ▼       ▼                        ▼                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Supabase Postgres                              │
│  accounts · usage_events · tickets · conversations · historical_deals  │
│  account_health_snapshot · account_health_history                      │
│  interventions · playbook_memory · csm_team · nps_responses            │
│  system_settings                                                       │
└────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ background dispatch
                                  │
            ┌─────────────────────┴────────────────────────┐
            ▼                                              ▼
   ┌────────────────────┐                    ┌──────────────────────────┐
   │ automations/       │                    │ slack_notifier           │
   │  channel_router    │                    │ (CSM notice every        │
   │  make_webhooks     │                    │  intervention)           │
   │  elevenlabs_client │                    └────────────┬─────────────┘
   └──────────┬─────────┘                                 │
              │                                           │
              ▼                                           ▼
   ┌──────────────────────────────────────┐   ┌──────────────────────┐
   │ Make.com webhooks                    │   │ MAKE_WEBHOOK_SLACK   │
   │  MAKE_WEBHOOK_EMAIL                  │   │ (shared scenario)    │
   │  MAKE_WEBHOOK_WHATSAPP               │   └──────────┬───────────┘
   │  MAKE_WEBHOOK_VOICE                  │              │
   └──────────┬─────────────┬─────────────┘              ▼
              │             │                  ┌──────────────────────┐
              ▼             ▼                  │ CSM Slack channel    │
        ┌─────────┐   ┌──────────┐             │ (notice + Approve/   │
        │ Email   │   │ WhatsApp │             │  Reject buttons via  │
        │ provider│   │ provider │             │  Block Kit)          │
        └─────────┘   └──────────┘             └──────────────────────┘
                                       ┌──────────────────────┐
                                       │ ElevenLabs ConvAI    │
                                       │ + Supabase Storage   │
                                       │ (audio_url for voice)│
                                       └──────────────────────┘
```

---

## 4. Verified End-to-End

- **Crystal Ball** — account `be3f7f5d-...` → score 85, confidence 0.9, 5 high-severity signals identified.
- **Expansion** — same account → score 20, `ready_to_expand=false` (correct: at-risk, not expansion candidate).
- **Intervention Engine** — ARR $248k account → email channel, playbook override fired, `pending_approval` (ARR>$50k save rule).
- **Email dispatch** — backend → Make webhook → real Gmail inbox delivery confirmed.
- **WhatsApp dispatch** — payload shape verified, Make scenario receives expected fields.
- **CSM Slack notify** — fired post-response via `BackgroundTasks`; structured JSON with all 17 fields.
- **Async batch** — 4 accounts processed in ~21s parallel; cool-off correctly skipped accounts with open interventions.
- **Outcome recording** — `negative` outcome on intervention `5d4e0bb8-...` → playbook stats updated 0.13 → 0.11.
- **Playbook regen** — same outcome triggered v1 (whatsapp, 0.13/9) → v2 (voice_call, fresh); old marked `superseded_by`; LLM rationale referenced specific failure pattern from interventions; Engine's selector confirmed to filter superseded playbooks.

---

## 5. Environment Variables

```
# Core
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=...                        # service_role
SUPABASE_SERVICE_ROLE_KEY=...           # storage uploads (voice audio)

# Make webhooks (one per channel)
MAKE_WEBHOOK_EMAIL=https://hook.us1.make.com/...
MAKE_WEBHOOK_WHATSAPP=https://hook.us1.make.com/...
MAKE_WEBHOOK_VOICE=https://hook.us1.make.com/...
MAKE_WEBHOOK_SLACK=https://hook.us1.make.com/...

# Voice
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
FALLBACK_AUDIO_URL=...                  # demo fallback if ElevenLabs fails

# Misc
API_BASE_URL=https://your-public-host    # for Make → /dispatch-intervention/callback
DEMO_SLACK_CHANNEL=#csm-alerts
LLM_PROVIDER=openai                      # or anthropic for seed scripts
```

---

## 6. What's Left / Open Items

### Resolved (since last update)
- ✅ Learning loop wired — regen fires automatically on outcome.
- ✅ Outcome → playbook stats — verified end-to-end.
- ✅ Closed-loop self-improvement demoable.
- ✅ Batch parallel processing.
- ✅ Cache rejects stale seed rows (forces real LLM run).
- ✅ Slack notifier fires for every intervention.

### Still missing
- **Approval endpoints** — `POST /interventions/{id}/approve|reject` not built. Manual `UPDATE interventions SET status='pending'` works for now. Make Slack scenario should call these once endpoints exist.
- **Pre-compute script for all 200 accounts** — use batch endpoint with `limit=200` instead, or build a dedicated CLI.
- **Email reply IMAP listener** — Make scenario for inbound `In-Reply-To` matching not wired (Persona 3 scope per CONTRACTS §3.6).
- **`champion_phone` column on `accounts`** — required for real voice/whatsapp. Engine downgrades to email until added (Persona 1 schema work).
- **Cross-account 14-day playbook diversity** — only same-account block enforced.
- **Demo "simulate reply" button** — useful for live demo; outcome curl is the manual workaround.

### Spec deviations
- Two LLM client paths coexist (`llm_client.py` unified vs direct `openai_client.py`). Persona-2 agents use `openai_client.py` directly. Decide canonical and remove dead path.
- `champion_phone` referenced by engine's recipient resolver, not in Persona 1's schema.

---

## 7. Quick Test Recipes

### Single agent
```bash
curl -s -X POST http://localhost:8000/api/v1/agents/crystal-ball/<uuid> \
  -H 'Content-Type: application/json' \
  -d '{"force_refresh":true}'
```

### Full pipeline batch (4 newest accounts)
```bash
curl -s -X POST http://localhost:8000/api/v1/agents/batch-process \
  -H 'Content-Type: application/json' \
  -d '{"limit":4,"trigger_reason":"churn_risk_high"}'
# → returns batch_id, then poll:
curl -s http://localhost:8000/api/v1/agents/batch-process/<batch_id> | jq
```

### Dispatch email after intervention
```bash
cat > /tmp/p.json <<'EOF'
{"intervention_id":"<id>","channel":"email","to":"x@y.com","to_name":"X","subject":"...","body":"..."}
EOF
curl -s -X POST http://localhost:8000/api/v1/dispatch-intervention \
  -H 'Content-Type: application/json' -d @/tmp/p.json
```

### Record outcome + auto-trigger regen
```bash
curl -s -X POST http://localhost:8000/api/v1/interventions/<id>/outcome \
  -H 'Content-Type: application/json' \
  -d '{"outcome":"negative","outcome_notes":"no reply"}' | jq
# → response includes regenerated_playbook field if threshold crossed
```

### Force a playbook to fail (for demo)
```sql
UPDATE playbook_memory
SET times_used=8, times_succeeded=1, success_rate=0.13
WHERE id='<playbook-uuid>';
```
Then record `negative` outcome on any intervention using that playbook → regen fires.

---

## 8. Demo Talk Track (1:30)

| Time | What to show |
|---|---|
| 0:00-0:15 | Problem framing — "B2B SaaS loses 15% revenue/yr to invisible churn. CSMs react instead of preventing." |
| 0:15-0:30 | Dashboard with 200 accounts, 12 flagged at-risk |
| 0:30-0:50 | Click critical account → Health Dashboard with score + signals + reasoning |
| 0:50-1:10 | Click "Launch intervention" → email/Slack/WhatsApp deliver in real time, live status updates |
| 1:10-1:25 | Closed-Loop view: agent's playbook P-007 evolved from v1 (whatsapp 0.13) to v2 (voice_call) — agent learned from observed failures |
| 1:25-1:30 | Close: "Crystal Ball + Expansion + Multi-channel + **Self-improving learning loop**" |

The wow moment is the playbook regen — that's the differentiator. Pre-cook one regen-pending state for the live demo.
