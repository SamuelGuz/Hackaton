# MY ROLE — Persona 2 (Agents & Intelligence Owner)

## Who I am

I am **Persona 2** on this 4-person team. I own the brain layer:
the three core agents (Crystal Ball, Expansion, Intervention Engine) and the
Closed-Loop Learning system that is our key differentiator.

## Architecture I'm building (per CONTRACTS.md section 2.5)

| Component | Type | Why |
|---|---|---|
| **Crystal Ball** | Autonomous agent (tool calling loop, max 10 turns) | Decides what data to explore based on the account |
| **Expansion** | Autonomous agent (tool calling loop, max 10 turns) | Same: depth of analysis depends on the account |
| **Intervention Engine** | Fixed-flow (single-shot LLM call, no tools) | Must be deterministic; no randomness during the demo |
| **Closed-Loop Learning** | Trigger function (NOT an agent) | Updates playbook stats after outcomes are recorded |

### Stack I use

- `openai` Python SDK directly (no LangGraph, no CrewAI, no Pydantic AI)
- `gpt-4o` for reasoning (main loop)
- `gpt-4o-mini` for internal utilities (sentiment, summarization)
- Stateless invocations (no conversation memory between calls)
- Communication between agents: ONLY via database. No direct calls.
- Logging: only final result, NOT intermediate turns
- `parallel_tool_calls=False` for predictability
- Use OpenAI structured outputs (`response_format` with json_schema) for the final analysis

## What I work on

### Files and folders I own
- `/backend/agents/crystal_ball.py` — autonomous agent with tool calling
- `/backend/agents/expansion.py` — autonomous agent with tool calling
- `/backend/agents/intervention_engine.py` — fixed-flow LLM call
- `/backend/agents/learning_loop.py` — function that updates playbook_memory on outcome
- `/backend/agents/tools/` — tool implementations (get_account_details, get_usage_events, etc.)
- `/backend/agents/prompts/` — system prompts and prompt templates
- `/backend/routes/agents.py` — agent endpoints
- `/backend/routes/playbooks.py` — closed-loop endpoints
- `/backend/scripts/precompute_snapshots.py` — pre-computes the 200 accounts before demo

### Tasks (from plan.md + section 2.5)
- [ ] Implement the 7 tools for Crystal Ball Agent (per CONTRACTS.md 2.5.4)
  - get_account_details, get_usage_events, get_tickets, get_conversations
  - analyze_sentiment_batch (uses gpt-4o-mini internally)
  - summarize_text (uses gpt-4o-mini internally)
  - search_similar_historical_deals
- [ ] Implement the 2 additional tools for Expansion Agent (CONTRACTS.md 2.5.5)
  - get_seat_utilization, get_feature_adoption
- [ ] Implement `submit_final_analysis` tool as loop terminator (recommended pattern)
- [ ] Build agent loop runner with max_turns=10, timeout=60s, retry on output parse fail
- [ ] Implement Crystal Ball agent (autonomous, with system prompt)
- [ ] Implement Expansion agent (autonomous, with system prompt)
- [ ] Implement Intervention Engine (fixed-flow, no tool calling)
- [ ] Implement Closed-Loop function (triggered by /interventions/{id}/outcome)
- [ ] Coordinate with Persona 1 on the 12 seed playbooks (sync session, ~20 min)
- [ ] Write smoke tests (CONTRACTS.md 2.5.10) — required before merge
- [ ] Run pre-compute script for the 200 accounts (CONTRACTS.md 2.5.9)
- [ ] Implement endpoints per CONTRACTS.md 2.2 and 2.3:
  - POST /agents/crystal-ball/{id}
  - POST /agents/expansion/{id}
  - POST /agents/intervention/{id}
  - POST /interventions/{id}/outcome
  - GET /playbooks
  - GET /playbooks/{id}/history

## What I do NOT touch

- ❌ `/backend/data/*` — that's Persona 1
- ❌ `/backend/main.py` (except adding my routes via include_router)
- ❌ Supabase schema definitions — request changes via CONTRACTS.md PR
- ❌ `/backend/automations/*` — that's Persona 3
- ❌ `/frontend/*` — that's Persona 4
- ❌ Make webhooks, ElevenLabs
- ❌ Calling other agents directly — communicate only via DB

## My branch

Working on: `persona-2/agent-tools` (start: implement the tools first)
Then: `persona-2/crystal-ball` (assemble the autonomous agent)
Then: `persona-2/expansion-agent`
Then: `persona-2/intervention-engine`
Then: `persona-2/closed-loop`
Then: `persona-2/precompute-script`

## Contracts I must respect

- I read from Supabase via shared `supabase_client.py` (or via tools that wrap it)
- I write only to: `account_health_snapshot`, `interventions` (status fields only after dispatch), `playbook_memory`
- All endpoint signatures from CONTRACTS.md section 2.2 and 2.3
- All agent tool signatures from CONTRACTS.md section 2.5.4 and 2.5.5
- Output JSON shapes are EXACT — frontend depends on them
- Agent config (CONTRACTS.md 2.5.3): max_turns=10, timeout=60s, temperature=0.3

## When I need something from another layer

- Need a new field in `accounts`? PR to CONTRACTS.md, ping Persona 1
- Need an intervention dispatched? Don't call Persona 3 directly — that's Persona 4's job (the frontend triggers dispatch)
- Need to display something? Tell Persona 4 the new endpoint shape

## Critical: things that break the team if I get wrong

1. **Slow LLM calls in demo path** — pre-compute scores for the 200 accounts BEFORE demo (CONTRACTS.md 2.5.9). NEVER call agents live during the 90s demo, except 1-2 controlled "fresh" accounts that Persona 4 marks.
2. **Inconsistent JSON output** — use `submit_final_analysis` tool pattern to capture structured output. Don't rely on parsing free text.
3. **Agent loops forever** — max_turns=10 hard limit. If hit, return partial result with `incomplete: true` flag.
4. **Tool errors crash the agent** — tools must return `{"error": "..."}` strings on failure, not raise exceptions. Let Claude decide whether to retry.
5. **Closed-loop not visible** — if I can't show the agent learning in the demo, our differentiator dies. Coordinate with Persona 4 early on what to visualize.
6. **Playbook memory ignored** — if Intervention Engine doesn't consult the memory and use `playbook_id_used`, the whole closed-loop story collapses.
7. **GPT-4o-mini tools fail silently** — `analyze_sentiment_batch` and `summarize_text` use gpt-4o-mini internally. Test their failure paths early.

## My north star

The judge needs to see, in 15 seconds, that the agent **chose differently after learning**.
Everything I build supports that single moment.

The autonomous nature of Crystal Ball and Expansion is the technical depth. The
closed-loop is the differentiator. Both must be visible in the demo.

## Quick reference: my agent loop pattern

```python
from openai import OpenAI

client = OpenAI()

def run_agent_loop(account_id: str, agent_type: str) -> dict:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPTS[agent_type]},
        {"role": "user", "content": initial_prompt(account_id)},
    ]
    tools = TOOLS_FOR[agent_type]  # includes submit_final_analysis

    for turn in range(MAX_TURNS):  # 10
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=4096,
            temperature=0.3,
            tools=tools,
            tool_choice="auto",
            parallel_tool_calls=False,  # determinístico
            messages=messages,
        )

        message = response.choices[0].message
        messages.append(message)  # important: append assistant response

        if message.tool_calls:
            for tool_call in message.tool_calls:
                # Special case: agent finished
                if tool_call.function.name == "submit_final_analysis":
                    final = json.loads(tool_call.function.arguments)
                    write_to_snapshot(account_id, final)
                    return final

                # Regular tool execution
                result = execute_tool(tool_call.function.name, tool_call.function.arguments)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                })
        else:
            # Unexpected: agent didn't use submit_final_analysis tool
            # Try to parse free text as fallback, or return error
            break

    return {"error": "max_turns_exceeded", "incomplete": True}
```

This is the skeleton. Adapt per agent.

**Notes on OpenAI specifics:**
- `tool_choice="auto"` lets the model decide when to call tools
- `parallel_tool_calls=False` forces one tool at a time (predictable for our demo)
- The `submit_final_analysis` tool's `arguments` field is already a JSON string with the schema-conformant output
- For tools that should return errors gracefully, return `{"error": "...", "details": "..."}` as the result, don't raise exceptions