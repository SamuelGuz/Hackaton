# MY ROLE — Persona 3 (Automation & Voice Owner)

> Copy this file to the repo root as `my-role.md` (it's gitignored, so it stays local).

## Who I am

I am **Persona 3** on this 4-person team. I own the action layer:
real-world delivery of interventions through Email, Slack, WhatsApp, and Voice.
I'm the one who makes the demo feel ALIVE — when the judge sees messages arrive in real time.

## What I work on

### Files and folders I own
- `/backend/automations/channel_router.py` — dispatches to correct channel
- `/backend/automations/elevenlabs_client.py` — voice synthesis
- `/backend/automations/make_webhooks.py` — webhook senders
- `/backend/routes/dispatch.py` — /dispatch-intervention endpoints
- Make workflows (4 of them: email, Slack, WhatsApp, voice)
- ElevenLabs voice clone configuration
- `/docs/runbook-fallbacks.md` — fallback procedures

### Tasks (from plan.md)
- [ ] Verify access: Make, ElevenLabs, Twilio (or WhatsApp Business)
- [ ] Clone voice in ElevenLabs (the "CSM" voice)
- [ ] Build Make workflow: Email dispatch + callback
- [ ] Build Make workflow: Slack dispatch + callback
- [ ] Build Make workflow: WhatsApp dispatch + callback
- [ ] Build Make workflow: Voice call dispatch + callback
- [ ] Implement endpoints: POST /dispatch-intervention, GET /dispatch-intervention/status/{id}
- [ ] Implement callback receiver: POST /dispatch-intervention/callback
- [ ] Generate audio with ElevenLabs BEFORE calling Make (per CONTRACTS.md section 3.4)
- [ ] Upload generated audio to Supabase Storage
- [ ] **Build fallback audio + email/Slack templates for demo emergencies**
- [ ] Test end-to-end delivery 5 times before demo

## What I do NOT touch

- ❌ `/backend/data/*` — Persona 1
- ❌ `/backend/agents/*` — Persona 2
- ❌ Supabase schemas — request via CONTRACTS.md PR
- ❌ `/frontend/*` — Persona 4
- ❌ Agent prompts or reasoning logic

## My branch

Working on: `persona-3/make-integration` (start)
Then: `persona-3/elevenlabs-voice`
Then: `persona-3/dispatch-endpoint`
Then: `persona-3/fallbacks`

## Contracts I must respect

- Webhook payloads EXACTLY as defined in CONTRACTS.md section 3
- All callbacks must include `intervention_id` and `status`
- I write only to `interventions` table (status, sent_at, delivered_at fields)
- Voice audio URL stored in `interventions.voice_audio_url`

## When I need something from another layer

- Need to know what message to send? It comes in the request from Persona 2's intervention engine.
- Need a new channel? Talk to the team first, update CONTRACTS.md.
- Frontend needs delivery status? Persona 4 calls my `/dispatch-intervention/status/{id}`.

## Critical: things that break the team if I get wrong

1. **ElevenLabs failure during demo** — MUST have pre-generated fallback audio ready. Test the failure path.
2. **Make rate limits** — don't fire all 4 channels at the exact same millisecond. Stagger by 500ms.
3. **No callback to FastAPI** — if Make doesn't call back, the frontend hangs showing "sending...". Every workflow MUST end with the callback.
4. **WhatsApp delivery failure** — Twilio/WhatsApp Business has approval requirements. Test EARLY (hour 1-4), not the night before.
5. **Voice latency** — generating ElevenLabs audio takes 5-15 seconds. Pre-generate for demo accounts.

## My north star

When the judge clicks "Launch intervention", they should see, within 30 seconds:
- ✓ Email delivered
- ✓ Slack message in channel
- ✓ WhatsApp received
- ✓ Voice call audio playing

If any of those is "failed" during the demo, our Execution score collapses.