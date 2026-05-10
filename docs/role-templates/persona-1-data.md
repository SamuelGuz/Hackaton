# MY ROLE — Persona 1 (Data & Backend Foundation Owner)

> Copy this file to the repo root as `my-role.md` (it's gitignored, so it stays local).

## Who I am

I am **Persona 1** on this 4-person team. I own the foundation layer:
the database, synthetic data generation, and the base FastAPI infrastructure
that everyone else depends on.

## What I work on

### Files and folders I own
- `/backend/data/*` — synthetic data generation, seed scripts, schemas
- `/backend/main.py` — FastAPI app entry point
- `/backend/routes/accounts.py` — accounts endpoints
- `/backend/shared/supabase_client.py` — Supabase connection
- `/backend/shared/claude_client.py` — Claude API wrapper (shared utility)
- `CONTRACTS.md` — I am the primary maintainer

### Tasks (from plan.md)
- [x] Setup repo structure, .env.example, .gitignore
- [x] Create Supabase project and configure tables per CONTRACTS.md section 1
- [x] Maintain CONTRACTS.md as the single source of truth
- [ ] Generate 200 synthetic accounts with Claude (varied buckets per CONTRACTS.md section 4)
- [ ] Generate usage events, tickets, conversations, historical deals
- [ ] Seed initial 12 playbooks (coordinate with Persona 2)
- [x] Implement endpoints: GET /accounts, GET /accounts/{id}, GET /accounts/{id}/timeline
- [x] Deploy backend to Railway/Render
- [ ] Support cross-team queries and debugging

## What I do NOT touch

- ❌ `/backend/agents/*` — that's Persona 2
- ❌ `/backend/automations/*` — that's Persona 3
- ❌ `/frontend/*` — that's Persona 4
- ❌ Make webhooks configuration
- ❌ ElevenLabs integration
- ❌ React components, Tailwind, Vercel deployment

## My branch

Working on: `persona-1/contracts-and-data` (initial)
Then: `persona-1/api-foundation`
Then: `persona-1/synthetic-data`

## Contracts I must respect

- All schemas defined in CONTRACTS.md section 1
- All endpoint signatures defined in CONTRACTS.md section 2.1
- snake_case in JSON keys
- UUIDs via uuid_generate_v4()
- Timestamps as TIMESTAMPTZ in UTC

## When I need something from another layer

- I post in Slack/Discord
- I do NOT generate code for other layers, even temporarily
- If blocking, I help the other person prioritize what I need

## Critical: things that break the team if I get wrong

1. **Schema changes without notice** — always update CONTRACTS.md first, then announce
2. **Breaking API contract** — if I change a response shape, frontend breaks silently
3. **Bad synthetic data** — if the data feels fake, the demo dies. Validate with team.
4. **Slow API** — frontend will timeout. Keep endpoints under 500ms (cache where needed).