# CONTRACTS.md — Churn Oracle

> **Documento sagrado del proyecto.** Define schemas de base de datos, contratos de API, webhooks de Make y estructuras de payload entre capas.
>
> **Regla:** si algo no está documentado acá, NO se asume. Se pregunta al equipo y se actualiza este documento.
>
> **Owner:** Persona 1 mantiene este documento. Cambios via PR con review obligatorio.

---

## 0. Convenciones globales

- **IDs:** todos UUID v4 (Postgres `uuid_generate_v4()`)
- **Timestamps:** todos `TIMESTAMPTZ` en UTC
- **Naming:** snake_case en DB y en JSON (consistencia total)
- **Enums:** se implementan como `TEXT` con CHECK constraint, no como tipo `ENUM` de Postgres (más flexible)
- **Soft deletes:** no se usan. Si algo se borra, se borra.
- **Tenant:** single-tenant. NO hay `tenant_id` en las tablas.
- **Empresa simulada:** "Acme SaaS Inc." — un B2B SaaS genérico con clientes en múltiples industrias.

---

## 1. Schema de base de datos (Supabase / Postgres)

### Diagrama de relaciones

```
accounts (1) ─┬─ (N) usage_events
              ├─ (N) tickets
              ├─ (N) conversations
              ├─ (N) interventions
              └─ (1) account_health_snapshot

interventions (N) ─── (1) playbook_memory  [via playbook_id_used]

historical_deals (independiente — solo lectura para entrenar prompts)
```

### Tabla `accounts`

La cuenta es la unidad central. Cada cuenta es un cliente de "Acme SaaS Inc."

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE accounts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  industry            TEXT NOT NULL CHECK (industry IN (
                        'fintech', 'healthtech', 'edtech', 'ecommerce',
                        'logistics', 'media', 'manufacturing', 'real_estate',
                        'hospitality', 'professional_services'
                      )),
  size                TEXT NOT NULL CHECK (size IN ('startup', 'smb', 'mid_market', 'enterprise')),
  geography           TEXT NOT NULL CHECK (geography IN ('latam', 'us', 'eu', 'apac')),
  plan                TEXT NOT NULL CHECK (plan IN ('starter', 'growth', 'business', 'enterprise')),
  arr_usd             NUMERIC(12,2) NOT NULL,
  seats_purchased     INTEGER NOT NULL,
  seats_active        INTEGER NOT NULL,
  signup_date         TIMESTAMPTZ NOT NULL,
  contract_renewal_date TIMESTAMPTZ NOT NULL,

  -- Champion (contacto principal)
  champion_name       TEXT NOT NULL,
  champion_email      TEXT NOT NULL,
  champion_role       TEXT NOT NULL,
  champion_changed_recently BOOLEAN DEFAULT FALSE,

  -- Asignación interna
  csm_assigned        TEXT NOT NULL,
  last_qbr_date       TIMESTAMPTZ,

  -- Metadata
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accounts_industry ON accounts(industry);
CREATE INDEX idx_accounts_renewal ON accounts(contract_renewal_date);
```

**Notas:**
- `arr_usd` es el ARR actual del cliente
- `seats_active / seats_purchased` da una métrica clave de uso
- `contract_renewal_date` es lo que el Crystal Ball usa para "90 días antes"
- `champion_changed_recently` es una señal sembrada por Persona 1 para algunas cuentas

---

### Tabla `usage_events`

Eventos de uso del producto. Granular para que el agente pueda detectar patrones.

```sql
CREATE TABLE usage_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN (
                'login', 'feature_used', 'report_generated',
                'api_call', 'integration_connected', 'integration_disconnected',
                'user_invited', 'user_removed', 'admin_action'
              )),
  feature_name TEXT,  -- relevante si event_type = 'feature_used'
  user_email   TEXT,  -- qué usuario disparó el evento
  occurred_at  TIMESTAMPTZ NOT NULL,
  metadata     JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_usage_account_time ON usage_events(account_id, occurred_at DESC);
CREATE INDEX idx_usage_event_type ON usage_events(event_type);
```

**Notas:**
- Persona 1 genera ~50-200 eventos por cuenta a lo largo de 6 meses
- Cuentas en riesgo deben mostrar caída de logins en las últimas 4-8 semanas
- Cuentas en expansion deben mostrar aumento de logins, features y `seats_active` cerca de `seats_purchased`

---

### Tabla `tickets`

Tickets de soporte. Una de las señales más fuertes de churn.

```sql
CREATE TABLE tickets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  description     TEXT NOT NULL,
  priority        TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status          TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved', 'escalated')),
  sentiment       TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'very_negative')),
  opened_at       TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  first_response_hours NUMERIC(6,2)
);

CREATE INDEX idx_tickets_account ON tickets(account_id);
CREATE INDEX idx_tickets_status ON tickets(status);
```

---

### Tabla `conversations`

Emails, calls (transcripts), Slack messages entre el CSM y el cliente.

```sql
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'call_transcript', 'slack', 'meeting_notes')),
  direction   TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  participants TEXT[] NOT NULL,
  subject     TEXT,
  content     TEXT NOT NULL,
  sentiment   TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'very_negative')),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_conversations_account_time ON conversations(account_id, occurred_at DESC);
```

---

### Tabla `interventions`

Cada intervención lanzada por el sistema. Esta tabla cierra el loop de aprendizaje.

```sql
CREATE TABLE interventions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Decisión del agente
  trigger_reason      TEXT NOT NULL,  -- "churn_risk_high", "expansion_ready", etc.
  channel             TEXT NOT NULL CHECK (channel IN ('email', 'slack', 'whatsapp', 'voice_call')),
  recipient           TEXT NOT NULL,  -- email, phone, slack handle
  message_subject     TEXT,
  message_body        TEXT NOT NULL,
  voice_audio_url     TEXT,           -- si channel = voice_call

  -- Contexto del agente
  playbook_id_used    UUID REFERENCES playbook_memory(id),
  agent_reasoning     TEXT NOT NULL,  -- por qué el agente eligió esta intervención
  confidence_score    NUMERIC(3,2),   -- 0.00 a 1.00

  -- Estado
  status              TEXT NOT NULL CHECK (status IN (
                        'pending', 'sent', 'delivered', 'opened',
                        'responded', 'failed'
                      )),
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  responded_at        TIMESTAMPTZ,

  -- Resultado (clave para closed-loop)
  outcome             TEXT CHECK (outcome IN (
                        'success', 'partial', 'no_response', 'negative', 'churned'
                      )),
  outcome_notes       TEXT,
  outcome_recorded_at TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_interventions_account ON interventions(account_id);
CREATE INDEX idx_interventions_outcome ON interventions(outcome);
CREATE INDEX idx_interventions_playbook ON interventions(playbook_id_used);
```

**Notas críticas:**
- `agent_reasoning` es lo que muestra el frontend para explicar la decisión
- `outcome` es lo que alimenta el closed-loop. Sin este campo, no hay aprendizaje.
- `voice_audio_url` apunta a Supabase Storage cuando el canal es voz

---

### Tabla `playbook_memory` (CORAZÓN DEL CLOSED-LOOP)

Almacena patrones de "qué intervención funciona para qué tipo de cuenta y señal".

```sql
CREATE TABLE playbook_memory (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Patrón identificado
  account_profile     JSONB NOT NULL,
  -- Ejemplo de account_profile:
  -- {
  --   "industry": ["fintech", "ecommerce"],
  --   "size": ["smb", "mid_market"],
  --   "plan": ["growth"],
  --   "arr_range": [10000, 50000]
  -- }

  signal_pattern      JSONB NOT NULL,
  -- Ejemplo de signal_pattern:
  -- {
  --   "logins_drop_pct": 50,
  --   "tickets_negative_count": 2,
  --   "champion_changed": false,
  --   "days_since_qbr": 90
  -- }

  -- Intervención recomendada
  recommended_channel TEXT NOT NULL CHECK (recommended_channel IN ('email', 'slack', 'whatsapp', 'voice_call')),
  message_template    TEXT NOT NULL,
  reasoning_template  TEXT NOT NULL,

  -- Estadísticas (se actualizan con cada outcome)
  times_used          INTEGER DEFAULT 0,
  times_succeeded     INTEGER DEFAULT 0,
  success_rate        NUMERIC(3,2) DEFAULT 0.00,

  -- Versionado
  version             INTEGER DEFAULT 1,
  superseded_by       UUID REFERENCES playbook_memory(id),

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_playbook_channel ON playbook_memory(recommended_channel);
CREATE INDEX idx_playbook_success_rate ON playbook_memory(success_rate DESC);
```

**Notas críticas:**
- Persona 1 pre-carga ~10-15 playbooks iniciales (seed)
- Persona 2 implementa la lógica que actualiza `times_used`, `times_succeeded`, `success_rate` cuando una intervención registra outcome
- Cuando un playbook tiene success_rate < 30% después de 5+ usos, se marca como superseded y se genera uno nuevo

---

### Tabla `historical_deals`

Deals ganados/perdidos del pasado. Solo lectura, sirve para que los agentes razonen sobre "qué funcionó antes".

```sql
CREATE TABLE historical_deals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_name        TEXT NOT NULL,
  industry            TEXT NOT NULL,
  size                TEXT NOT NULL,
  arr_usd             NUMERIC(12,2),
  status              TEXT NOT NULL CHECK (status IN ('won', 'lost', 'churned', 'expanded')),
  reason_given        TEXT,
  reason_real         TEXT,  -- la objeción real (puede diferir de la dicha)
  conversation_summary TEXT NOT NULL,
  lessons_learned     TEXT NOT NULL,
  closed_at           TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_historical_status ON historical_deals(status);
CREATE INDEX idx_historical_industry ON historical_deals(industry);
```

**Notas:**
- Persona 1 genera ~50 deals históricos
- Mitad ganados/expandidos, mitad perdidos/churned
- Variedad de razones: precio, integración, equipo, performance, competencia

---

### Tabla `account_health_snapshot`

Vista pre-calculada del health de cada cuenta. Se actualiza cada vez que un agente analiza una cuenta. **Esto es crítico para el demo: evita llamar al LLM en vivo.**

```sql
CREATE TABLE account_health_snapshot (
  account_id          UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,

  -- Crystal Ball output
  churn_risk_score    INTEGER NOT NULL CHECK (churn_risk_score BETWEEN 0 AND 100),
  top_signals         JSONB NOT NULL,
  predicted_churn_reason TEXT,
  crystal_ball_confidence NUMERIC(3,2),
  crystal_ball_reasoning TEXT NOT NULL,

  -- Expansion output
  expansion_score     INTEGER NOT NULL CHECK (expansion_score BETWEEN 0 AND 100),
  ready_to_expand     BOOLEAN DEFAULT FALSE,
  recommended_plan    TEXT,
  expansion_reasoning TEXT,
  suggested_upsell_message TEXT,

  -- Computed health (combinación)
  health_status       TEXT NOT NULL CHECK (health_status IN ('critical', 'at_risk', 'stable', 'healthy', 'expanding')),

  computed_at         TIMESTAMPTZ DEFAULT NOW(),
  computed_by_version TEXT NOT NULL  -- ej "crystal-ball-v1.2"
);

CREATE INDEX idx_health_status ON account_health_snapshot(health_status);
CREATE INDEX idx_health_risk_score ON account_health_snapshot(churn_risk_score DESC);
```

---

## 2. Contratos de la API (FastAPI)

> **Base URL:** `https://churn-oracle-api.{deploy}.app/api/v1`
> **Auth:** API key en header `X-API-Key` (single token compartido para el demo)
> **Formato:** todos los endpoints retornan JSON. Errores siguen el formato `{"error": "code", "message": "human readable"}`.

### 2.1 Accounts (Persona 1)

#### `GET /accounts`
Lista de cuentas con health snapshot.

**Query params:**
- `health_status` (opcional): filtrar por estado
- `industry` (opcional)
- `limit` (default 200)
- `offset` (default 0)

**Response 200:**
```json
{
  "accounts": [
    {
      "id": "uuid",
      "name": "Acme Corp",
      "industry": "fintech",
      "size": "mid_market",
      "plan": "growth",
      "arr_usd": 48000.00,
      "champion_name": "María Pérez",
      "csm_assigned": "Carlos López",
      "contract_renewal_date": "2026-08-15T00:00:00Z",
      "health_status": "at_risk",
      "churn_risk_score": 73,
      "expansion_score": 12
    }
  ],
  "total": 200
}
```

#### `GET /accounts/{account_id}`
Detalle completo de una cuenta.

**Response 200:**
```json
{
  "id": "uuid",
  "name": "Acme Corp",
  "industry": "fintech",
  "size": "mid_market",
  "geography": "latam",
  "plan": "growth",
  "arr_usd": 48000.00,
  "seats_purchased": 50,
  "seats_active": 23,
  "signup_date": "2024-03-10T00:00:00Z",
  "contract_renewal_date": "2026-08-15T00:00:00Z",
  "champion": {
    "name": "María Pérez",
    "email": "maria@acmecorp.com",
    "role": "VP Operations",
    "changed_recently": false
  },
  "csm_assigned": "Carlos López",
  "last_qbr_date": "2026-02-10T00:00:00Z",
  "health": {
    "status": "at_risk",
    "churn_risk_score": 73,
    "top_signals": [
      {"signal": "logins_drop_pct", "value": 62, "severity": "high"},
      {"signal": "tickets_unresolved", "value": 2, "severity": "medium"},
      {"signal": "days_since_qbr", "value": 88, "severity": "medium"}
    ],
    "predicted_churn_reason": "Caída sostenida de uso + tickets sin resolver del módulo de reportes",
    "crystal_ball_reasoning": "...",
    "expansion_score": 12,
    "ready_to_expand": false
  }
}
```

#### `GET /accounts/{account_id}/timeline`
Timeline de eventos para el Health Dashboard.

**Response 200:**
```json
{
  "account_id": "uuid",
  "events": [
    {
      "type": "usage_event",
      "subtype": "login",
      "timestamp": "2026-05-08T14:23:00Z",
      "summary": "12 logins esta semana (vs 47 hace 4 semanas)"
    },
    {
      "type": "ticket",
      "subtype": "opened",
      "timestamp": "2026-05-05T09:15:00Z",
      "summary": "Ticket abierto: 'Reportes lentos' (sentiment: negative)"
    },
    {
      "type": "conversation",
      "subtype": "email",
      "timestamp": "2026-04-30T11:00:00Z",
      "summary": "Email del champion: 'Estamos evaluando alternativas...'"
    }
  ]
}
```

---

### 2.2 Agents (Persona 2)

#### `POST /agents/crystal-ball/{account_id}`
Ejecuta el Crystal Ball Agent sobre una cuenta. Actualiza `account_health_snapshot`.

**Body:** vacío o `{"force_refresh": true}` para ignorar cache.

**Response 200:**
```json
{
  "account_id": "uuid",
  "churn_risk_score": 73,
  "top_signals": [
    {"signal": "logins_drop_pct", "value": 62, "severity": "high"},
    {"signal": "tickets_unresolved", "value": 2, "severity": "medium"}
  ],
  "predicted_churn_reason": "Caída sostenida de uso + tickets sin resolver",
  "confidence": 0.84,
  "reasoning": "Esta cuenta muestra el patrón clásico de pre-churn de fintech mid-market...",
  "computed_at": "2026-05-09T17:30:00Z"
}
```

#### `POST /agents/expansion/{account_id}`
Ejecuta el Expansion Agent.

**Response 200:**
```json
{
  "account_id": "uuid",
  "expansion_score": 78,
  "ready_to_expand": true,
  "recommended_plan": "business",
  "reasoning": "Logins +210% en últimas 4 semanas, seats al 92% de capacidad...",
  "suggested_upsell_message": "Hola María, vimos que el equipo creció 3x...",
  "computed_at": "2026-05-09T17:30:00Z"
}
```

#### `POST /agents/intervention/{account_id}`
Genera (sin lanzar) una intervención recomendada para la cuenta.

**Body:**
```json
{
  "trigger_reason": "churn_risk_high"
}
```

**Response 200:**
```json
{
  "account_id": "uuid",
  "trigger_reason": "churn_risk_high",
  "recommended_channel": "voice_call",
  "recipient": "+57 300 1234567",
  "message_subject": null,
  "message_body": "Hola María, soy Carlos de Acme SaaS. Vi que tuviste algunos issues...",
  "playbook_id_used": "uuid",
  "playbook_success_rate_at_decision": 0.72,
  "agent_reasoning": "Para cuentas fintech mid-market con caída de logins y tickets negativos, el playbook P-007 ha tenido 72% de éxito. Voz personal supera a email en este perfil.",
  "confidence": 0.81
}
```

---

### 2.3 Closed-Loop (Persona 2)

#### `POST /interventions/{intervention_id}/outcome`
Registra el resultado de una intervención. Dispara la actualización del playbook memory.

**Body:**
```json
{
  "outcome": "success",
  "outcome_notes": "Cliente respondió en 2 horas, agendó renovación"
}
```

**Response 200:**
```json
{
  "intervention_id": "uuid",
  "outcome_recorded": true,
  "playbook_updated": {
    "playbook_id": "uuid",
    "previous_success_rate": 0.65,
    "new_success_rate": 0.72,
    "times_used": 11
  }
}
```

#### `GET /playbooks`
Lista de playbooks con sus stats. Para visualizar el closed-loop en frontend.

**Response 200:**
```json
{
  "playbooks": [
    {
      "id": "uuid",
      "name": "P-007 — Voice call para fintech mid-market en pre-churn",
      "account_profile": {...},
      "signal_pattern": {...},
      "recommended_channel": "voice_call",
      "times_used": 11,
      "times_succeeded": 8,
      "success_rate": 0.72,
      "version": 1
    }
  ]
}
```

#### `GET /playbooks/{playbook_id}/history`
Historia de cambios de un playbook (para mostrar evolución).

**Response 200:**
```json
{
  "playbook_id": "uuid",
  "evolution": [
    {"version": 1, "success_rate": 0.65, "times_used": 5, "as_of": "..."},
    {"version": 1, "success_rate": 0.72, "times_used": 11, "as_of": "..."}
  ]
}
```

---

### 2.4 Dispatch (Persona 3)

#### `POST /dispatch-intervention`
**Endpoint crítico.** Lanza la intervención al canal real vía Make.

**Body:**
```json
{
  "intervention_id": "uuid",
  "channel": "voice_call",
  "recipient": "+57 300 1234567",
  "message_body": "Hola María, soy Carlos...",
  "message_subject": null,
  "voice_config": {
    "voice_id": "elevenlabs-voice-id",
    "speed": 1.0
  }
}
```

**Response 202 (accepted):**
```json
{
  "intervention_id": "uuid",
  "status": "dispatched",
  "channel": "voice_call",
  "make_execution_id": "make-exec-12345",
  "estimated_delivery_seconds": 15
}
```

**Response 500:**
```json
{
  "error": "dispatch_failed",
  "message": "ElevenLabs API timeout",
  "fallback_used": true,
  "fallback_audio_url": "https://..."
}
```

#### `POST /dispatch-intervention/status/{intervention_id}`
Consulta el estado de delivery (para que el frontend muestre el "✓ entregado").

**Response 200:**
```json
{
  "intervention_id": "uuid",
  "status": "delivered",
  "channel_status": {
    "email": "delivered",
    "slack": "delivered",
    "whatsapp": "delivered",
    "voice_call": "delivered"
  },
  "timestamps": {
    "sent_at": "2026-05-09T17:31:00Z",
    "delivered_at": "2026-05-09T17:31:15Z"
  }
}
```

---

## 3. Webhooks de Make (Persona 3)

> **Patrón:** FastAPI llama a webhooks de Make. Make ejecuta el workflow y opcionalmente llama de vuelta a FastAPI con el resultado.

### 3.1 Webhook: Email Dispatch

**URL:** `https://hook.make.com/{webhook-id-email}`

**Payload que envía FastAPI:**
```json
{
  "intervention_id": "uuid",
  "to": "maria@acmecorp.com",
  "subject": "María, ¿podemos hablar 5 minutos?",
  "body": "Hola María,\n\nVi que...",
  "from_name": "Carlos López",
  "from_email": "carlos@acmesaas.io",
  "callback_url": "https://churn-oracle-api.../api/v1/dispatch-intervention/callback"
}
```

**Workflow en Make:**
1. Recibe webhook
2. Envía email vía Gmail/SendGrid module
3. Llama callback con `{intervention_id, status: "delivered" | "failed"}`

---

### 3.2 Webhook: Slack Dispatch

**URL:** `https://hook.make.com/{webhook-id-slack}`

**Payload:**
```json
{
  "intervention_id": "uuid",
  "channel": "#csm-alerts",
  "message": ":rotating_light: Cuenta en riesgo: *Acme Corp*\n\nChurn risk: 73%\nAcción sugerida: ...",
  "csm_to_mention": "@carlos",
  "callback_url": "..."
}
```

**Workflow:** recibe → posta en Slack via Slack module → callback.

---

### 3.3 Webhook: WhatsApp Dispatch

**URL:** `https://hook.make.com/{webhook-id-whatsapp}`

**Payload:**
```json
{
  "intervention_id": "uuid",
  "to_phone": "+573001234567",
  "message": "Hola María, soy Carlos de Acme SaaS...",
  "callback_url": "..."
}
```

**Workflow:** recibe → envía vía Twilio o WhatsApp Business module → callback.

---

### 3.4 Webhook: Voice Call Dispatch

**URL:** `https://hook.make.com/{webhook-id-voice}`

**Payload:**
```json
{
  "intervention_id": "uuid",
  "to_phone": "+573001234567",
  "audio_url": "https://supabase.../audio/intervention-uuid.mp3",
  "fallback_text": "Hola, soy Carlos...",
  "callback_url": "..."
}
```

**Workflow:**
1. Recibe webhook con `audio_url` (audio ya generado por ElevenLabs antes del dispatch)
2. Llama a Twilio (o servicio similar) con TwiML que reproduce el audio
3. Callback con resultado

**NOTA:** la generación del audio con ElevenLabs ocurre ANTES en `/dispatch-intervention` (FastAPI llama ElevenLabs, sube el MP3 a Supabase Storage, y pasa la URL a Make).

---

### 3.5 Callback de Make a FastAPI

**Endpoint:** `POST /api/v1/dispatch-intervention/callback`

**Payload (de Make):**
```json
{
  "intervention_id": "uuid",
  "channel": "email",
  "status": "delivered",
  "external_id": "msg_abc123",
  "delivered_at": "2026-05-09T17:31:15Z",
  "error_message": null
}
```

---

## 4. Estructura de generación de data sintética (Persona 1)

> Persona 1 usa Claude API para generar la data. Estos son los contratos de los prompts.

### 4.1 Generación de cuentas

**Para cada una de las 200 cuentas, generar:**
- Perfil base (nombre realista, industria, tamaño, etc.)
- Asignar a uno de 5 "buckets":

| Bucket | % | Características |
|---|---|---|
| `healthy_stable` | 40% | Uso constante, sin tickets graves, NPS alto |
| `at_risk_subtle` | 20% | Caídas leves, 1-2 tickets, champion ok — riesgo no obvio |
| `at_risk_obvious` | 15% | Caídas fuertes, tickets negativos, champion cambió |
| `expansion_ready` | 15% | Crecimiento de uso, seats casi al límite |
| `expansion_subtle` | 10% | Uso creciente pero plan correcto — aún no obvio |

**Cuentas "trampa" para el demo (Persona 1 las marca):**
- Al menos 3 cuentas de `at_risk_subtle` que el agente debería detectar y un humano probablemente no
- Al menos 2 cuentas de `expansion_subtle` que muestren oportunidades no obvias

### 4.2 Generación de eventos por cuenta

Para cada cuenta, según su bucket, generar:
- 100-300 eventos de uso a lo largo de 6 meses
- 0-5 tickets
- 5-20 conversaciones (emails, calls)

**Patrones a sembrar:**
- `at_risk_*`: caída de logins en últimas 4-8 semanas, tickets sin resolver con sentiment negativo, último QBR > 80 días
- `expansion_*`: aumento de logins, seats activos cerca del límite, conversaciones positivas pidiendo features avanzadas

### 4.3 Playbooks iniciales (seed)

**Persona 1 inserta ~12 playbooks iniciales** (definidos en colaboración con Persona 2). Cobertura mínima:
- 3 playbooks para churn (email, WhatsApp, voice)
- 3 playbooks para expansion
- 3 playbooks por industria principal
- 3 playbooks por tamaño (smb, mid_market, enterprise)

Estos playbooks tienen `times_used` y `times_succeeded` ya inicializados con valores realistas (ej: 8/11, 6/10) para que el sistema arranque con memoria útil.

---

## 5. Variables de entorno (`.env.example`)

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=

# Claude
ANTHROPIC_API_KEY=
CLAUDE_MODEL_REASONING=claude-sonnet-4-6
CLAUDE_MODEL_FAST=claude-haiku-4-5-20251001

# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# Make webhooks
MAKE_WEBHOOK_EMAIL=https://hook.make.com/...
MAKE_WEBHOOK_SLACK=https://hook.make.com/...
MAKE_WEBHOOK_WHATSAPP=https://hook.make.com/...
MAKE_WEBHOOK_VOICE=https://hook.make.com/...

# API
API_KEY=                         # token único para auth interna
API_BASE_URL=https://churn-oracle-api.../api/v1

# Frontend
VITE_API_BASE_URL=
VITE_API_KEY=

# Demo controlable
DEMO_EMAIL_RECIPIENT=team@acmesaas.demo
DEMO_SLACK_CHANNEL=#demo-alerts
DEMO_WHATSAPP_NUMBER=+57...
DEMO_VOICE_NUMBER=+57...
```

---

## 6. Acuerdos de naming y formato

- **Endpoints:** kebab-case en URLs (`/dispatch-intervention`)
- **JSON keys:** snake_case (`account_id`, no `accountId`)
- **Python:** snake_case (PEP-8)
- **TypeScript:** camelCase para variables, PascalCase para tipos. **Convertir snake_case ↔ camelCase en la capa de API client del frontend.**
- **Branches Git:** `persona-N/feature-name` (kebab-case en feature)
- **Commits:** convencionales (`feat:`, `fix:`, `chore:`, `docs:`)

---

## 7. Manejo de errores

Todos los endpoints retornan errores en este formato:

```json
{
  "error": "code_in_snake_case",
  "message": "Mensaje legible para humanos",
  "details": {}
}
```

**Códigos comunes:**
- `account_not_found` (404)
- `agent_timeout` (504)
- `dispatch_failed` (500)
- `invalid_payload` (400)
- `unauthorized` (401)

---

## 8. Lo que está fuera de alcance (para no perder tiempo)

- ❌ Multi-tenant
- ❌ Auth de usuarios (login/signup)
- ❌ Rate limiting sofisticado
- ❌ Tests automatizados (excepto smoke tests del happy path)
- ❌ i18n
- ❌ Mobile responsive (desktop-first es suficiente para el demo)
- ❌ Dark mode (a menos que sea trivial en Tailwind)

---

## 9. Checklist de "contracts listos para empezar"

Persona 1 marca esto cuando todo lo siguiente está hecho:

- [ ] Repo creado con la estructura de carpetas del `plan.md`
- [ ] Supabase project creado y conectado
- [ ] Todas las tablas de la sección 1 creadas con sus índices
- [ ] `.env.example` con todas las variables documentadas
- [ ] Endpoints stub de FastAPI creados (devuelven mock pero la firma está)
- [ ] Documento `CONTRACTS.md` (este) commiteado en main
- [ ] Mensaje al equipo: "contratos listos, pueden empezar capa 2/3/4"

---

## 10. Cómo proponer cambios a este documento

1. Crear branch `persona-N/contracts-update-{descripcion}`
2. Editar `CONTRACTS.md`
3. PR con descripción del cambio + impacto en otras capas
4. Review obligatorio de Persona 1 + una persona afectada
5. Merge → notificar al equipo en el canal

**No cambies este documento sin avisar.** Si alguien depende de un contrato y lo cambias en silencio, rompés el sistema.

---

**Última actualización:** Inicio del proyecto.
**Próxima revisión:** Después del kickoff, cuando los 4 lo lean y propongan ajustes.