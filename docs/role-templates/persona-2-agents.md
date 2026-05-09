# MY ROLE — Persona 2 (Agents & Intelligence Owner)

> Copy this file to the repo root as `my-role.md` (it's gitignored, so it stays local).

## Who I am

I am **Persona 2** on this 4-person team. I own the brain layer:
the three core agents (Crystal Ball, Expansion, Intervention Engine) and the
Closed-Loop Learning system that is our key differentiator.

## What I work on

### Files and folders I own
- `/backend/agents/crystal_ball.py` — churn risk detection
- `/backend/agents/expansion.py` — expansion opportunity detection
- `/backend/agents/intervention_engine.py` — chooses which intervention to launch
- `/backend/agents/learning_loop.py` — playbook memory updater (THE differentiator)
- `/backend/routes/agents.py` — agent endpoints
- `/backend/routes/playbooks.py` — closed-loop endpoints
- `/backend/prompts/*.py` — prompt templates

### Tasks (from plan.md)
- [ ] Design and iterate prompts for Crystal Ball Agent
- [ ] Design and iterate prompts for Expansion Agent
- [ ] Build Intervention Engine that consults playbook memory
- [ ] Build Closed-Loop Learning System (success_rate updater, version handling)
- [ ] Implement endpoints: POST /agents/crystal-ball/{id}, POST /agents/expansion/{id}, POST /agents/intervention/{id}
- [ ] Implement endpoints: POST /interventions/{id}/outcome, GET /playbooks, GET /playbooks/{id}/history
- [ ] Coordinate with Persona 1 on the 12 seed playbooks
- [ ] Pre-compute health snapshots for the demo accounts (avoid live LLM calls)

## What I do NOT touch

- ❌ `/backend/data/*` — that's Persona 1
- ❌ `/backend/main.py` (except adding my routes via include_router)
- ❌ Supabase schema definitions — request changes via CONTRACTS.md PR
- ❌ `/backend/automations/*` — that's Persona 3
- ❌ `/frontend/*` — that's Persona 4
- ❌ Make webhooks, ElevenLabs

## My branch

Working on: `persona-2/crystal-ball` (start)
Then: `persona-2/expansion-agent`
Then: `persona-2/intervention-engine`
Then: `persona-2/closed-loop`

## Contracts I must respect

- I read from Supabase via Persona 1's API or shared `supabase_client.py`
- I write only to: `account_health_snapshot`, `interventions`, `playbook_memory`
- All endpoint signatures from CONTRACTS.md section 2.2 and 2.3
- Output JSON shapes are EXACT — frontend depends on them

## When I need something from another layer

- Need a new field in `accounts`? PR to CONTRACTS.md, ping Persona 1
- Need an intervention dispatched? Call Persona 3's `/dispatch-intervention`
- Need to display something? Tell Persona 4 the new endpoint shape

## Critical: things that break the team if I get wrong

1. **Slow LLM calls in demo path** — pre-compute scores, never call LLM live during the 90s demo
2. **Inconsistent JSON output** — if the agent returns different shapes, frontend breaks. Use Pydantic models strictly.
3. **Closed-loop not visible** — if I can't show the agent learning in the demo, our differentiator dies. Coordinate with Persona 4 early.
4. **Playbook memory ignored** — if Intervention Engine doesn't consult the memory, the whole closed-loop story collapses.

## My north star

The judge needs to see, in 15 seconds, that the agent **chose differently after learning**.
Everything I build supports that single moment.