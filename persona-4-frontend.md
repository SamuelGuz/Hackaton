# MY ROLE — Persona 4 (Frontend & Demo Owner)

> Copy this file to the repo root as `my-role.md` (it's gitignored, so it stays local).

## Who I am

I am **Persona 4** on this 4-person team. I own the face layer:
the frontend that the judge sees, and the demo script that wins us the hackathon.

I am also responsible for the Presentation score (5 pts) and for ensuring
the wow moment lands within the first 30 seconds of our 90-second demo.

## What I work on

### Files and folders I own
- `/frontend/*` — entire React app (Vite + Tailwind)
- `/frontend/src/pages/*` — the 4 demo views
- `/frontend/src/components/*` — UI components
- `/frontend/src/api/*` — API client (consumes FastAPI)
- `/frontend/src/types/*` — TypeScript types (camelCase, converted from API snake_case)
- `/frontend/src/mocks/*` — mock data while backend isn't ready
- `demo-script.md` — the 90-second pitch script
- Vercel deployment

### Tasks (from plan.md)
- [ ] Setup Vite + React + Tailwind
- [ ] Setup API client with snake_case ↔ camelCase conversion
- [ ] Build View 1: Account list (Health Dashboard global)
- [ ] Build View 2: Account detail (Health Dashboard per account)
- [ ] Build View 3: Intervention modal (with editable message)
- [ ] Build View 4: Closed-Loop Visualization (THE wow moment)
- [ ] Add live status indicators (✓ delivered for each channel)
- [ ] Write 90-second demo script (cronometrado)
- [ ] Pre-cook the demo: pick the 3 exact accounts to show
- [ ] Practice demo 5 times before submission
- [ ] Deploy to Vercel with public link

## What I do NOT touch

- ❌ `/backend/*` — anything backend
- ❌ Supabase directly — only consume FastAPI endpoints
- ❌ Make workflows
- ❌ ElevenLabs configuration
- ❌ LLM calls from frontend (always go through FastAPI)
- ❌ Synthetic data generation

## My branch

Working on: `persona-4/dashboard-mvp` (start with views 1 & 2)
Then: `persona-4/intervention-modal`
Then: `persona-4/closed-loop-viz` (THE differentiator visual)
Then: `persona-4/demo-polish`

## Contracts I must respect

- Endpoints from CONTRACTS.md section 2 only
- Convert snake_case from API to camelCase at the API client boundary
- Use TypeScript types that match the API contract exactly
- Mock data follows the same shape as real API responses

## When I need something from another layer

- Need a new endpoint? Talk to Persona 1 (data) or Persona 2 (agents) BEFORE building UI for it
- Need a different response shape? PR to CONTRACTS.md with reasoning
- Need delivery confirmation? Persona 3's `/dispatch-intervention/status/{id}`
- Need to show the closed-loop? Persona 2 must give me the data structure

## Critical: things that break the team if I get wrong

1. **Polished but broken** — "End-to-end beats polished" per the brief. Functional ugly > beautiful empty.
2. **Demo over 90 seconds** — we get cut off. Cronometrar OBSESIVAMENTE.
3. **Wow moment buried** — judges decide in the first 30 seconds. The differentiator (closed-loop or multi-channel delivery) must hit FAST.
4. **Live LLM calls in demo** — latency kills the pacing. Always show pre-computed data during demo.
5. **No fallback for API failure** — if backend hiccups during demo, I need a graceful degradation (cached data, offline mode).

## My north star — THE 90-second demo flow

| Seconds | What happens | What the judge feels |
|---|---|---|
| 0:00–0:15 | "Companies lose 15% revenue to invisible churn" | "Yeah, real problem" |
| 0:15–0:30 | Dashboard with 200 accounts, 12 flagged | "Oh, they actually built something" |
| 0:30–0:50 | Click critical account → Health Dashboard with reasoning | "It explains itself, not just predicts" |
| 0:50–1:10 | Click "Launch" → email/Slack/WhatsApp/voice deliver LIVE | "Wait, that's actually being sent right now?!" |
| 1:10–1:25 | Show closed-loop: agent's playbook evolved | "It LEARNS. Nobody else has that." |
| 1:25–1:30 | Close: "Crystal Ball + Expansion + Health + Action + Learning" | Judge writes 5/5 on Creativity |

If any second in that table doesn't land, I fix it before submission.