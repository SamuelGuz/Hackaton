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
csm_team (1) ─── (N) accounts                        [via accounts.csm_id]
csm_team (1) ─── (N) interventions                   [via interventions.approved_by]

accounts (1) ─┬─ (N) usage_events
              ├─ (N) tickets
              ├─ (N) conversations
              ├─ (N) interventions
              ├─ (N) nps_responses
              ├─ (N) account_health_history
              └─ (1) account_health_snapshot

interventions (N) ─── (1) playbook_memory  [via playbook_id_used]

historical_deals     (independiente — solo lectura para entrenar prompts)
system_settings      (independiente — toggles globales: auto-approval, etc.)
```

### Tabla `csm_team`

Equipo interno de Customer Success Managers. Es el directorio que el sistema usa para mencionar a un CSM en Slack (`@carlos`), enviarle un email, escalar por WhatsApp, o registrar quién aprobó una intervención.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE csm_team (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  slack_handle    TEXT,           -- ej "@carlos" (display) o "U01ABC..." (Slack user id)
  slack_user_id   TEXT,           -- id interno de Slack para @-mention real (opcional)
  phone           TEXT,           -- E.164: "+573001234567"
  role            TEXT NOT NULL CHECK (role IN (
                    'csm', 'senior_csm', 'csm_manager', 'head_of_cs'
                  )),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_csm_team_active ON csm_team(active);
CREATE INDEX idx_csm_team_role   ON csm_team(role);
```

**Notas:**

- Persona 1 siembra 4-6 CSMs reales (nombres ficticios pero realistas) en seed.
- `slack_handle` es lo que se muestra en el mensaje (`@carlos`); `slack_user_id` es lo que Make/Slack API necesita para hacer un mention real (`<@U01ABC...>`). Ambos opcionales por si una cuenta usa solo email.
- `accounts.csm_id` referencia esta tabla (FK obligatorio).
- `interventions.approved_by` también referencia esta tabla (FK opcional, NULL si auto-aprobada o aún pendiente).

---

### Tabla `accounts`

La cuenta es la unidad central. Cada cuenta es un cliente de "Acme SaaS Inc."

```sql
CREATE TABLE accounts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_number      TEXT NOT NULL,
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
  champion_phone      TEXT,           -- E.164: celular del champion (SMS/WhatsApp); NULL si no cargado
  champion_changed_recently BOOLEAN DEFAULT FALSE,

  -- Asignación interna
  csm_id              UUID NOT NULL REFERENCES csm_team(id),
  last_qbr_date       TIMESTAMPTZ,

  -- NPS denormalizado (último valor registrado, para listas/queries rápidas)
  -- El histórico vive en la tabla nps_responses
  current_nps_score   INTEGER CHECK (current_nps_score BETWEEN 0 AND 10),
  current_nps_category TEXT CHECK (current_nps_category IN ('detractor', 'passive', 'promoter')),
  last_nps_at         TIMESTAMPTZ,

  -- Metadata
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_accounts_account_number ON accounts(account_number);
CREATE INDEX idx_accounts_industry ON accounts(industry);
CREATE INDEX idx_accounts_renewal  ON accounts(contract_renewal_date);
CREATE INDEX idx_accounts_csm      ON accounts(csm_id);
CREATE INDEX idx_accounts_nps      ON accounts(current_nps_category);
```

**Notas:**

- `account_number` es el identificador comercial de la cuenta (número de cliente / CRM), estable y legible por humanos; distinto del `id` UUID interno.
- `arr_usd` es el ARR actual del cliente
- `seats_active / seats_purchased` da una métrica clave de uso
- `contract_renewal_date` es lo que el Crystal Ball usa para "90 días antes"
- `champion_phone` es el móvil del contacto principal (mismo formato E.164 que `csm_team.phone`).
- `champion_changed_recently` es una señal sembrada por Persona 1 para algunas cuentas
- **Breaking change vs versión anterior:** `csm_assigned TEXT` fue reemplazado por `csm_id UUID FK → csm_team(id)`. Frontend y agentes deben hacer JOIN para obtener nombre/handle.
- `current_nps_score`, `current_nps_category`, `last_nps_at` son denormalizaciones del último row en `nps_responses` para evitar JOINs en listas. Persona 1 mantiene esto sincronizado vía trigger o write-through en el endpoint que registra NPS.

**Migración (cuentas ya creadas en Supabase):**

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS champion_phone TEXT;
```

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

### Tabla `nps_responses`

Respuestas NPS (Net Promoter Score) del cliente. Una de las señales explícitas más fuertes que el agente puede usar (mencionada en los buckets `at_risk_*` con NPS bajo y `healthy_stable` con NPS alto).

```sql
CREATE TABLE nps_responses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  category        TEXT NOT NULL CHECK (category IN ('detractor', 'passive', 'promoter')),
  -- Regla estándar NPS:
  --   0-6  → detractor
  --   7-8  → passive
  --   9-10 → promoter

  feedback        TEXT,                -- comentario libre del respondente (opcional)
  respondent_email TEXT NOT NULL,
  respondent_role  TEXT,               -- "VP Operations", "Admin", "End User"
  survey_trigger   TEXT NOT NULL CHECK (survey_trigger IN (
                    'quarterly', 'post_ticket', 'post_qbr', 'post_renewal', 'manual'
                  )),

  submitted_at    TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nps_account_time ON nps_responses(account_id, submitted_at DESC);
CREATE INDEX idx_nps_category     ON nps_responses(category);
CREATE INDEX idx_nps_score        ON nps_responses(score);
```

**Notas:**

- Persona 1 siembra 1-4 respuestas NPS por cuenta a lo largo de los últimos 12 meses, con score coherente al bucket de la cuenta:
  - `healthy_stable`: scores 9-10 mayoría
  - `at_risk_subtle`: scores 7-8 (passive — la trampa para humanos)
  - `at_risk_obvious`: scores 0-5 (detractor)
  - `expansion_`*: scores 8-10
- El último NPS se denormaliza en `accounts.current_nps_*` para queries rápidas en listas.
- El Crystal Ball Agent puede leer esta tabla vía un nuevo tool `get_nps_history` (Persona 2 lo agrega a su lista de tools si quiere usar la señal).

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

  -- Aprobación humana (gate antes del dispatch)
  requires_approval   BOOLEAN NOT NULL DEFAULT FALSE,  -- decidido por el Intervention Engine
  approved_by         UUID REFERENCES csm_team(id),    -- NULL si auto-aprobada o aún pendiente
  approved_at         TIMESTAMPTZ,                     -- cuándo se aprobó (auto o manual)
  auto_approved       BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE si pasó por el toggle global de auto-approval
  rejection_reason    TEXT,                            -- solo cuando status = 'rejected'

  -- Estado (incluye gate de aprobación + lifecycle de delivery)
  status              TEXT NOT NULL CHECK (status IN (
                        'pending_approval',  -- requires_approval=true, esperando humano
                        'rejected',          -- terminal: humano rechazó
                        'pending',           -- aprobada (auto o manual) o no requería approval, lista para dispatch
                        'sent',
                        'delivered',
                        'opened',
                        'responded',
                        'failed'
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

CREATE INDEX idx_interventions_account  ON interventions(account_id);
CREATE INDEX idx_interventions_outcome  ON interventions(outcome);
CREATE INDEX idx_interventions_playbook ON interventions(playbook_id_used);
CREATE INDEX idx_interventions_status   ON interventions(status);
CREATE INDEX idx_interventions_pending_approval ON interventions(status) WHERE status = 'pending_approval';
```

**Notas críticas:**

- `agent_reasoning` es lo que muestra el frontend para explicar la decisión
- `outcome` es lo que alimenta el closed-loop. Sin este campo, no hay aprendizaje.
- `voice_audio_url` apunta a Supabase Storage cuando el canal es voz

**Flujo de aprobación (lectura obligatoria para Persona 2 y 3):**

1. El **Intervention Engine** (Persona 2) genera la intervención y devuelve `requires_approval: bool` en su output.
2. FastAPI persiste la intervención y decide el `status` inicial:
  - Si `requires_approval = false` → `status = 'pending'` (lista para dispatch).
  - Si `requires_approval = true`:
    - Lee `system_settings.auto_approval_enabled`.
    - Si **TRUE** → marca `auto_approved = true`, `approved_at = now()`, `approved_by = NULL`, `status = 'pending'`.
    - Si **FALSE** → `status = 'pending_approval'`. El dispatcher NO debe lanzarla hasta que un CSM apruebe vía `POST /interventions/{id}/approve`.
3. Si un humano aprueba → `approved_by = <csm_id>`, `approved_at = now()`, `auto_approved = false`, `status = 'pending'`.
4. Si un humano rechaza → `rejection_reason` se llena, `status = 'rejected'` (terminal). El dispatcher la ignora.
5. El endpoint `POST /dispatch-intervention` (Persona 3) **debe** validar que `status IN ('pending')` antes de hacer dispatch. Si está en `pending_approval` o `rejected`, devuelve `409 Conflict` con `{"error": "intervention_not_approved"}`.

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

### Tabla `account_health_history`

Snapshot **append-only** del health a lo largo del tiempo. Es lo que permite mostrar en el demo *"el riesgo subió de 40 a 73 en 3 semanas"* — tendencia visual poderosa.

```sql
CREATE TABLE account_health_history (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Mismos campos clave que account_health_snapshot, congelados al momento del cómputo
  churn_risk_score    INTEGER NOT NULL CHECK (churn_risk_score BETWEEN 0 AND 100),
  expansion_score     INTEGER NOT NULL CHECK (expansion_score BETWEEN 0 AND 100),
  health_status       TEXT NOT NULL CHECK (health_status IN (
                        'critical', 'at_risk', 'stable', 'healthy', 'expanding'
                      )),
  top_signals         JSONB,
  predicted_churn_reason TEXT,
  crystal_ball_confidence NUMERIC(3,2),

  computed_at         TIMESTAMPTZ NOT NULL,
  computed_by_version TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_health_history_account_time ON account_health_history(account_id, computed_at DESC);
CREATE INDEX idx_health_history_status_time  ON account_health_history(health_status, computed_at DESC);
```

**Notas críticas:**

- **Regla de oro:** cada vez que se escribe a `account_health_snapshot` (UPSERT), Persona 2 (o el wrapper en FastAPI) **también** inserta un row en `account_health_history`. NO hay UPDATE en history — siempre INSERT.
- Esto permite que el frontend grafique churn/expansion score en el tiempo sin perder data histórica cada vez que el agente recalcula.
- Persona 1 siembra entre 3 y 8 entradas históricas por cuenta (una cada ~2 semanas en los últimos 3 meses) para que el demo arranque con curvas visibles.
- Para cuentas en bucket `at_risk_`*, sembrar tendencia ascendente del churn_risk_score (ej: 35 → 48 → 61 → 73). Para `expansion_*`, tendencia ascendente del expansion_score.

---

### Tabla `system_settings`

Toggles globales del sistema. Single-tenant, así que es una tabla key-value simple.

```sql
CREATE TABLE system_settings (
  key             TEXT PRIMARY KEY,
  value           JSONB NOT NULL,
  description     TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_by      UUID REFERENCES csm_team(id)
);

-- Seed obligatorio (Persona 1 lo inserta junto con el schema)
INSERT INTO system_settings (key, value, description) VALUES
  ('auto_approval_enabled',
   'false'::jsonb,
   'Si TRUE, las intervenciones con requires_approval=true se aprueban automáticamente sin esperar a un humano. Si FALSE, quedan en status=pending_approval hasta que un CSM apruebe/rechace.'),
  ('auto_approval_max_arr_usd',
   '25000'::jsonb,
   'Cuando auto_approval_enabled=true, solo aprueba auto si arr_usd de la cuenta <= este valor. Cuentas más grandes siempre pasan por humano.'),
  ('auto_approval_min_confidence',
   '0.80'::jsonb,
   'Cuando auto_approval_enabled=true, solo aprueba auto si confidence_score >= este valor.');
```

**Notas:**

- El frontend tiene un toggle visible (en sección de configuración del demo) que llama a `PUT /settings/auto_approval_enabled` con `{"value": true|false}`.
- Las thresholds (`max_arr_usd`, `min_confidence`) son guardrails: aunque auto-approval esté activo, intervenciones de cuentas grandes o de baja confianza igual van al humano.
- `value` es JSONB para permitir tipos mixtos (boolean, number, string, array) sin migrar el schema.

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
      "account_number": "ACC-2024-00482",
      "name": "Acme Corp",
      "industry": "fintech",
      "size": "mid_market",
      "plan": "growth",
      "arr_usd": 48000.00,
      "champion_name": "María Pérez",
      "champion_phone": "+5215512345678",
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
  "account_number": "ACC-2024-00482",
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
    "phone": "+5215512345678",
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

**Nota (implementación extendida):** además de `usage_event`, `ticket` y `conversation`, el backend puede incluir `nps_response`, `health_history` e `intervention` con el mismo shape (`type`, `subtype`, `timestamp`, `summary`) para enriquecer el dashboard.

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

#### `GET /accounts/health-history`

Lista paginada de filas de `account_health_history` (solo lectura). Útil para dashboards globales o depuración.

**Query params:**

- `account_id` (opcional): filtrar por cuenta
- `health_status` (opcional): filtrar por estado (`critical`, `at_risk`, `stable`, `healthy`, `expanding`)
- `from` (opcional): `computed_at >= from` (ISO 8601, TIMESTAMPTZ UTC)
- `to` (opcional): `computed_at <= to` (ISO 8601, TIMESTAMPTZ UTC)
- `limit` (default 100, máx 500)
- `offset` (default 0)

Orden: `computed_at` descendente.

**Response 200:**

```json
{
  "items": [
    {
      "id": "uuid",
      "account_id": "uuid",
      "health_status": "at_risk",
      "churn_risk_score": 73,
      "expansion_score": 12,
      "top_signals": [],
      "predicted_churn_reason": "…",
      "crystal_ball_confidence": 0.84,
      "computed_at": "2026-05-09T17:30:00Z",
      "computed_by_version": "crystal-ball-v1.2"
    }
  ],
  "total": 1240,
  "limit": 100,
  "offset": 0
}
```

#### `GET /accounts/{account_id}/health-history`

Historial de salud append-only para una cuenta. Misma forma de respuesta que el listado global, con `items` filtrados a esa cuenta.

**Query params:** `health_status`, `from`, `to`, `limit`, `offset` (mismos significados que arriba; no se expone `account_id` en query porque va en la ruta).

**Response 404** si la cuenta no existe.

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

**Response 409** — no se inserta fila en `interventions`. Casos típicos:

- No existe `account_health_snapshot` para la cuenta: ejecutar antes Crystal Ball / Expansion (`detail` describe el bloqueo).
- Cool-off u otras reglas temporales (p. ej. 72h, bloqueo de playbook 14 días): mensaje en `detail` (texto).
- **Intervención abierta:** ya existe una fila para `account_id` con `status` en `pending_approval`, `pending`, `sent`, `delivered`, `opened` o `responded` (defensa en profundidad; el frontend también debe bloquear el CTA).

**Coordinación de capas:** este endpoint es responsabilidad **Persona 2** (agente); cambios que afecten UI o automatización requieren alineación con **Persona 4** / **Persona 3** y actualización de este documento.

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

**Endpoint crítico.** Lanza la intervención al canal real. En `voice_call` demo usa sesión ConvAI (sin Make/Twilio).

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
  "session_mode": "convai",
  "signed_url": "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_xxx&conversation_signature=cvtkn_xxx",
  "estimated_delivery_seconds": 15
}
```

**Response 500:**

```json
{
  "error": "dispatch_failed",
  "message": "ElevenLabs ConvAI signed URL error"
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

## 2.5 Arquitectura de agentes (Persona 2)

> **Esta sección define cómo se construyen los agentes internamente.** Es el contrato técnico para Persona 2 y debe respetarse para que el sistema sea coherente.

### 2.5.1 Decisiones arquitectónicas


| Decisión                                    | Valor                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Framework                                   | OpenAI Python SDK (`openai` package)                                                              |
| Modelo principal                            | `gpt-4o` (reasoning loop)                                                                         |
| Modelo auxiliar                             | `gpt-4o-mini` (sentiment, summarization)                                                          |
| Modelo solo para data sintética (Persona 1) | `gemini-2.5-pro` via Google SDK (one-shot, fuera del runtime)                                     |
| Comunicación entre agentes                  | Solo vía base de datos. No invocaciones directas.                                                 |
| Memoria conversacional                      | No. Cada invocación es stateless.                                                                 |
| Logging                                     | Solo resultado final. NO se loguean turns intermedios.                                            |
| Tool calling                                | OpenAI function calling (`tools` parameter) con `parallel_tool_calls: false` para predictibilidad |
| Structured output                           | OpenAI structured outputs (`response_format` con JSON schema) para el final analysis              |


### 2.5.2 Tipo de agente por componente


| Agente                  | Tipo                              | Razón                                                                             |
| ----------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| **Crystal Ball**        | Autónomo (loop con tool calling)  | Necesita decidir cuántos tickets/conversaciones explorar según la cuenta          |
| **Expansion**           | Autónomo (loop con tool calling)  | Igual: profundidad de análisis depende de la cuenta                               |
| **Intervention Engine** | Flujo fijo (single-shot LLM call) | Decisión debe ser determinística y rápida; no puede haber aleatoriedad en el demo |


### 2.5.3 Contrato de agente autónomo (Crystal Ball, Expansion)

**Loop básico:**

```
1. FastAPI recibe POST /agents/{name}/{account_id}
2. Construye system prompt + user prompt inicial
3. Inicia loop con max_turns = 10:
   a. Llama Claude con tools disponibles
   b. Si Claude pide tool_use → ejecuta tool → devuelve tool_result
   c. Si Claude devuelve mensaje final con structured output → break
   d. Si turns == 10 sin output final → return error "max_turns_exceeded"
4. Valida output con Pydantic model
5. Escribe a account_health_snapshot
6. Devuelve response al cliente
```

**Configuración estándar:**

```python
AGENT_CONFIG = {
    "model": "gpt-4o",
    "max_tokens": 4096,
    "max_turns": 10,
    "timeout_seconds": 60,
    "temperature": 0.3,  # baja para consistencia
    "parallel_tool_calls": False,  # determinístico
}
```

**Manejo de errores:**

- Tool call falla → devolver `{"error": "..."}` al agente, dejarlo decidir si reintenta
- Max turns alcanzado → log + devolver último análisis parcial con flag `incomplete: true`
- Timeout → return 504 al cliente con mensaje claro
- Output no parseable → 1 retry con instrucción de fix; si falla otra vez, 500

### 2.5.4 Tools disponibles para Crystal Ball Agent

Persona 2 implementa estas tools como funciones Python que el agente puede llamar.

#### `get_account_details`

**Descripción:** Obtiene info base de la cuenta (número de cuenta, industria, tamaño, plan, ARR, contract dates, champion incl. teléfono móvil).
**Input schema:**

```json
{
  "account_id": "string (uuid)"
}
```

**Output:** Account object completo (mismo shape que `GET /accounts/{id}` sin el bloque `health`).

#### `get_usage_events`

**Descripción:** Obtiene eventos de uso de la cuenta. Permite filtrar por rango de fechas y tipo de evento.
**Input schema:**

```json
{
  "account_id": "string (uuid)",
  "since_days_ago": "integer (default: 90)",
  "event_types": "array of strings (optional)",
  "aggregate_by": "enum: 'day' | 'week' | 'none' (default: 'week')"
}
```

**Output:** Lista de eventos o agregaciones según `aggregate_by`.

#### `get_tickets`

**Descripción:** Obtiene tickets de soporte de la cuenta.
**Input schema:**

```json
{
  "account_id": "string (uuid)",
  "status_filter": "enum: 'all' | 'open' | 'unresolved' (default: 'all')",
  "limit": "integer (default: 20)"
}
```

**Output:** Lista de tickets con sentiment incluido.

#### `get_conversations`

**Descripción:** Obtiene conversaciones recientes con la cuenta (emails, calls, slack).
**Input schema:**

```json
{
  "account_id": "string (uuid)",
  "last_n": "integer (default: 10)",
  "channel_filter": "enum: 'all' | 'email' | 'call_transcript' | 'slack' (default: 'all')"
}
```

**Output:** Lista de conversaciones con sentiment.

#### `analyze_sentiment_batch` *(usa GPT-4o-mini)*

**Descripción:** Analiza sentiment de un batch de textos. Usa GPT-4o-mini internamente para ser rápido y barato.
**Input schema:**

```json
{
  "texts": "array of strings",
  "context": "string (optional, ej: 'support ticket')"
}
```

**Output:** Array de `{text_index, sentiment, confidence}`.
**Notas:** Esta tool internamente llama a `gpt-4o-mini` con un prompt corto. No expone el modelo auxiliar como tool genérica al agente; es una utilidad de sentiment.

#### `summarize_text` *(usa GPT-4o-mini)*

**Descripción:** Resume un texto largo (ej: transcript de call).
**Input schema:**

```json
{
  "text": "string",
  "max_words": "integer (default: 50)"
}
```

**Output:** `{summary: string, key_points: array}`.

#### `search_similar_historical_deals`

**Descripción:** Busca deals históricos con perfil similar. Usado para razonar "qué pasó antes con cuentas como esta".
**Input schema:**

```json
{
  "industry": "string",
  "size": "string",
  "arr_range": "[number, number]",
  "status_filter": "enum: 'all' | 'won' | 'lost' | 'churned' | 'expanded'",
  "limit": "integer (default: 5)"
}
```

**Output:** Lista de deals con `reason_real`, `lessons_learned`, etc.

### 2.5.5 Tools disponibles para Expansion Agent

Mismas que Crystal Ball **excepto** `search_similar_historical_deals` con filter `'expanded'` por default. Adicionalmente:

#### `get_seat_utilization`

**Descripción:** Calcula utilización de seats activos vs comprados a lo largo del tiempo.
**Input schema:**

```json
{
  "account_id": "string (uuid)",
  "lookback_days": "integer (default: 90)"
}
```

**Output:** `{current_utilization_pct, trend, weeks_at_high_utilization}`.

#### `get_feature_adoption`

**Descripción:** Qué features está usando la cuenta y cuáles del plan superior aún no.
**Input schema:**

```json
{
  "account_id": "string (uuid)"
}
```

**Output:** `{features_used: [], features_in_higher_plan_unused: [], adoption_score: number}`.

### 2.5.6 Output structured de agentes autónomos

**Crystal Ball Agent debe terminar el loop devolviendo un mensaje con este JSON exacto:**

```json
{
  "churn_risk_score": 73,
  "top_signals": [
    {"signal": "logins_drop_pct", "value": 62, "severity": "high"},
    {"signal": "tickets_unresolved", "value": 2, "severity": "medium"}
  ],
  "predicted_churn_reason": "Caída sostenida de uso + tickets sin resolver",
  "confidence": 0.84,
  "reasoning": "Esta cuenta muestra el patrón clásico de pre-churn..."
}
```

**Expansion Agent output:**

```json
{
  "expansion_score": 78,
  "ready_to_expand": true,
  "recommended_plan": "business",
  "reasoning": "Logins +210%, seats al 92%...",
  "suggested_upsell_message": "Hola María, vimos que..."
}
```

**Cómo se obtiene el structured output:**

- Opción 1 (recomendada): última herramienta del agente es `submit_final_analysis` con el schema completo. El agente llama esa tool cuando termina, FastAPI captura el input.
- Opción 2: parsing del último mensaje del agente con `json.loads()`. Menos robusto pero más simple.

### 2.5.7 Contrato de Intervention Engine (flujo fijo, no autónomo)

**Sin tool calling.** Es una llamada single-shot a Claude que:

1. Recibe `account_id` + `trigger_reason`
2. Lee de DB (vía función Python, no tool):
  - El `account_health_snapshot` ya calculado
  - Los playbooks relevantes (filtrados por `account_profile` matching)
  - Las últimas 3 intervenciones a esa cuenta (para no repetir)
3. Llama Claude con un prompt estructurado pidiendo decisión
4. Output JSON: el playbook elegido + mensaje personalizado + reasoning

**Configuración:**

```python
INTERVENTION_ENGINE_CONFIG = {
    "model": "gpt-4o",
    "max_tokens": 2048,
    "temperature": 0.4,
    "timeout_seconds": 30,
    "response_format": {"type": "json_schema", "json_schema": INTERVENTION_OUTPUT_SCHEMA},
    # No max_turns: es single-shot
}
```

**Output esperado** (mismo que CONTRACTS.md sección 2.2 — `POST /agents/intervention/{account_id}`):

```json
{
  "recommended_channel": "voice_call",
  "recipient": "+57 300 1234567",
  "message_body": "Hola María...",
  "playbook_id_used": "uuid",
  "playbook_success_rate_at_decision": 0.72,
  "agent_reasoning": "Para cuentas fintech mid-market...",
  "confidence": 0.81
}
```

### 2.5.8 Contrato de Closed-Loop Learning (no es agente, es función)

**No es un agente.** Es una función Python que se ejecuta cuando se registra un `outcome` en una intervention.

**Trigger:** `POST /interventions/{id}/outcome` (definido en sección 2.3)

**Lógica:**

1. Recibe outcome (success | partial | no_response | negative | churned)
2. Carga el playbook que se usó (`playbook_id_used` de la intervention)
3. Actualiza:
  - `times_used += 1`
  - Si outcome ∈ {success, partial}: `times_succeeded += 1`
  - `success_rate = times_succeeded / times_used`
4. Si `success_rate < 0.30 AND times_used >= 5`:
  - Marca el playbook como deprecated (`superseded_by` se llena después)
  - Trigger una llamada al LLM para generar un playbook mejorado
  - El nuevo playbook arranca con `times_used=0, times_succeeded=0, version=N+1`
5. Devuelve resumen del cambio

### 2.5.9 Pre-cómputo de health snapshots (CRÍTICO PARA EL DEMO)

Persona 2 debe correr **antes del demo** un script que:

1. Itera sobre las 200 cuentas
2. Llama Crystal Ball Agent + Expansion Agent para cada una
3. Persiste resultado en `account_health_snapshot`

**Razón:** durante los 90s del demo no hay tiempo de esperar 60s de loop autónomo por cuenta. Las cuentas mostradas tienen su análisis listo en DB.

**Excepción demo interactivo:** Persona 4 puede definir 1-2 cuentas "frescas" donde el agente sí corre en vivo durante el demo (para mostrar capacidad real). Estas cuentas deben tener data de tamaño moderado para que el loop termine en <30s.

### 2.5.10 Smoke test obligatorio antes de integración

Antes de mergear a `main`, Persona 2 debe correr este test:

```python
# tests/smoke_agents.py
def test_crystal_ball_completes():
    response = call_crystal_ball(test_account_id)
    assert response.churn_risk_score is not None
    assert 0 <= response.churn_risk_score <= 100
    assert len(response.top_signals) >= 1
    assert response.confidence is not None
 
def test_expansion_completes():
    # ...similar
    pass
 
def test_intervention_engine_uses_playbook():
    response = call_intervention(test_account_id, "churn_risk_high")
    assert response.playbook_id_used is not None
```

## Si el smoke test falla, no se mergea.

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

1. FastAPI solicita `signed_url` a ElevenLabs ConvAI (`get_signed_url`) al despachar `voice_call`.
2. Frontend se conecta por WebSocket usando `signed_url` y ejecuta la conversación en página.
3. Backend puede recibir callback/estado final y/o resumen de conversación para cerrar el loop.

---

### 3.5 Callback de Make a FastAPI (delivery confirmation)

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

**Notas:**

- Sólo confirma entrega/lectura. NO trae contenido de respuesta del cliente.
- Para respuestas del cliente al email/WhatsApp/Slack, ver sección 3.6.

---

### 3.6 Customer Response Webhook (Persona 3 + Persona 2)

> **Endpoint inbound** que Make llama cuando un cliente responde a una intervención (reply de email, mensaje de WhatsApp entrante, mensaje en Slack DM, etc.). Cierra el loop pasando del "enviado" al "outcome registrado".

**Endpoint:** `POST /api/v1/dispatch-intervention/customer-response`

**Configuración de Make (Persona 3):**

- **Email:** Make filtra el inbox de `carlos@acmesaas.io` por `In-Reply-To` o `References` que matchee un `external_id` previo, extrae cuerpo + sender, y dispara este webhook.
- **WhatsApp:** Make escucha mensajes entrantes en el número del demo, matchea por `to_phone` con la intervención más reciente a esa cuenta.
- **Slack:** Make escucha eventos `message.channels` o `message.im`, matchea por `external_id` o por `thread_ts`.

**Payload (de Make):**

```json
{
  "intervention_id": "uuid",
  "channel": "email",
  "received_at": "2026-05-09T17:45:00Z",
  "from_address": "maria@acmecorp.com",
  "from_name": "María Pérez",
  "subject": "Re: María, ¿podemos hablar 5 minutos?",
  "body": "Hola Carlos, gracias por escribir. Sí, agendemos algo el jueves a las 3pm. Me interesa que veamos juntos lo del módulo de reportes.",
  "external_id": "msg_reply_xyz789",
  "in_reply_to": "msg_abc123"
}
```

**Lógica del endpoint (Persona 3 implementa, Persona 2 expone helpers):**

1. Busca la `intervention_id`. Si no existe → 404.
2. Inserta una row en `conversations`:
  - `account_id` = el de la intervention
  - `channel` = mismo del payload
  - `direction` = `'inbound'`
  - `participants` = `[from_address]`
  - `subject` = `subject` del payload
  - `content` = `body`
  - `occurred_at` = `received_at`
3. Llama internamente a `analyze_sentiment_batch` (tool de Persona 2 que usa Haiku) con el `body`. Recibe `sentiment ∈ {positive, neutral, negative, very_negative}` y `confidence`.
4. Actualiza la conversación con el `sentiment` analizado.
5. Actualiza la `intervention`:
  - `status = 'responded'`
  - `responded_at = received_at`
6. **Auto-outcome** según sentiment:
  - `positive` → `outcome = 'success'`
  - `neutral` → `outcome = 'partial'`
  - `negative` → `outcome = 'negative'`
  - `very_negative` → `outcome = 'negative'`
  - `outcome_notes` = `"Auto-detectado de respuesta {channel} (sentiment={sentiment}, confidence={x.xx})"`
  - `outcome_recorded_at = NOW()`
7. **Dispara el closed-loop** llamando a la lógica de actualización de `playbook_memory` (la misma que `POST /interventions/{id}/outcome`, definida en sección 2.5.8).

**Response 200:**

```json
{
  "intervention_id": "uuid",
  "conversation_id": "uuid",
  "auto_outcome_assigned": "success",
  "sentiment_detected": "positive",
  "sentiment_confidence": 0.92,
  "playbook_updated": {
    "playbook_id": "uuid",
    "previous_success_rate": 0.65,
    "new_success_rate": 0.71,
    "times_used": 12
  }
}
```

**Response 409 (intervención no estaba lista para recibir respuesta):**

```json
{
  "error": "intervention_not_dispatched",
  "message": "La intervención está en status='pending_approval'. No se debería recibir respuesta del cliente todavía.",
  "details": {"current_status": "pending_approval"}
}
```

**Notas críticas:**

- **Override manual:** un CSM puede sobrescribir el outcome auto-asignado vía `POST /interventions/{id}/outcome` con un `outcome` diferente y `outcome_notes` indicando "Override manual: ...". Eso vuelve a disparar el closed-loop con la métrica corregida.
- **Idempotencia:** si llega el mismo `external_id` dos veces, el endpoint devuelve 200 con el conversation_id ya existente, sin duplicar rows ni re-disparar el closed-loop.
- **Sentiment confidence baja:** si `sentiment_confidence < 0.6`, el endpoint igual asigna el outcome pero marca un flag `requires_human_review = true` en el response. El frontend lo destaca para que un CSM lo confirme.

---

## 4. Estructura de generación de data sintética (Persona 1)

> Persona 1 usa Claude API para generar la data. Estos son los contratos de los prompts.

### 4.0 CSM Team (seed)

**Antes que cualquier otra cosa**, Persona 1 inserta 4-6 CSMs en `csm_team`. Sin esto, `accounts.csm_id` no se puede llenar (FK NOT NULL).

Ejemplo mínimo:


| name            | role        | email                                           | slack_handle |
| --------------- | ----------- | ----------------------------------------------- | ------------ |
| Carlos López    | senior_csm  | [carlos@acmesaas.io](mailto:carlos@acmesaas.io) | @carlos      |
| Ana Restrepo    | csm         | [ana@acmesaas.io](mailto:ana@acmesaas.io)       | @ana         |
| Diego Martínez  | csm         | [diego@acmesaas.io](mailto:diego@acmesaas.io)   | @diego       |
| Laura Gómez     | csm_manager | [laura@acmesaas.io](mailto:laura@acmesaas.io)   | @laura       |
| Sofía Hernández | head_of_cs  | [sofia@acmesaas.io](mailto:sofia@acmesaas.io)   | @sofia       |


**Reglas de asignación cuenta → CSM:**

- Distribuir las 200 cuentas entre los CSMs (no equitativo: el `csm_manager` y `head_of_cs` tienen pocas cuentas, los `csm` tienen ~50-60 cada uno).
- Cuentas `enterprise` y ARR > $100k → asignar al `senior_csm` o `csm_manager`.

### 4.1 Generación de cuentas

**Para cada una de las 200 cuentas, generar:**

- Perfil base (nombre realista, industria, tamaño, etc.)
- `csm_id` apuntando a un CSM válido del seed 4.0
- Asignar a uno de 5 "buckets":


| Bucket             | %   | Características                                    | NPS típico      |
| ------------------ | --- | -------------------------------------------------- | --------------- |
| `healthy_stable`   | 40% | Uso constante, sin tickets graves                  | 9-10 (promoter) |
| `at_risk_subtle`   | 20% | Caídas leves, 1-2 tickets, champion ok             | 7-8 (passive)   |
| `at_risk_obvious`  | 15% | Caídas fuertes, tickets negativos, champion cambió | 0-5 (detractor) |
| `expansion_ready`  | 15% | Crecimiento de uso, seats casi al límite           | 8-10            |
| `expansion_subtle` | 10% | Uso creciente pero plan correcto — aún no obvio    | 8-9             |


**Cuentas "trampa" para el demo (Persona 1 las marca):**

- Al menos 3 cuentas de `at_risk_subtle` que el agente debería detectar y un humano probablemente no
- Al menos 2 cuentas de `expansion_subtle` que muestren oportunidades no obvias

### 4.2 Generación de eventos por cuenta

Para cada cuenta, según su bucket, generar:

- 100-300 eventos de uso a lo largo de 6 meses
- 0-5 tickets
- 5-20 conversaciones (emails, calls)
- **1-4 respuestas NPS** distribuidas en los últimos 12 meses, con score coherente al bucket
- **3-8 entradas en `account_health_history`** (una cada ~2 semanas en los últimos 3 meses) que muestren tendencia coherente con el bucket

**Patrones a sembrar:**

- `at_risk_`*: caída de logins en últimas 4-8 semanas, tickets sin resolver con sentiment negativo, último QBR > 80 días, NPS bajando (ej: 8 → 6 → 4), `churn_risk_score` ascendente en history (ej: 35 → 48 → 61 → 73)
- `expansion_*`: aumento de logins, seats activos cerca del límite, conversaciones positivas pidiendo features avanzadas, NPS estable o subiendo, `expansion_score` ascendente en history (ej: 45 → 60 → 72 → 78)

### 4.3 Playbooks iniciales (seed)

**Persona 1 inserta ~12 playbooks iniciales** (definidos en colaboración con Persona 2). Cobertura mínima:

- 3 playbooks para churn (email, WhatsApp, voice)
- 3 playbooks para expansion
- 3 playbooks por industria principal
- 3 playbooks por tamaño (smb, mid_market, enterprise)

Estos playbooks tienen `times_used` y `times_succeeded` ya inicializados con valores realistas (ej: 8/11, 6/10) para que el sistema arranque con memoria útil.

### 4.4 System settings (seed)

Persona 1 inserta los 3 settings iniciales (ver `INSERT INTO system_settings ...` en sección 1, tabla `system_settings`):

- `auto_approval_enabled = false` (default conservador)
- `auto_approval_max_arr_usd = 25000`
- `auto_approval_min_confidence = 0.80`

### 4.5 Resumen de orden de seeding

Por dependencias FK, el orden obligatorio es:

1. `csm_team` (sin dependencias)
2. `system_settings` (sin dependencias, pero `updated_by` puede referenciar csm_team)
3. `accounts` (depende de `csm_team`)
4. `usage_events`, `tickets`, `conversations`, `nps_responses` (dependen de `accounts`)
5. `historical_deals` (independiente)
6. `playbook_memory` (independiente)
7. `account_health_snapshot` + `account_health_history` (dependen de `accounts`; insertar el snapshot actual y 3-8 entradas históricas por cuenta)
8. `interventions` (opcional en seed: solo si Persona 1 sembra ejemplos para que el frontend muestre algo desde el inicio; depende de `accounts`, `csm_team` y `playbook_memory`)

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
- `csm_not_found` (404)
- `intervention_not_found` (404)
- `intervention_not_pending_approval` (409) — al intentar aprobar/rechazar una que no está en `pending_approval`
- `intervention_not_approved` (409) — al intentar `dispatch` de una que no está en `pending`
- `intervention_not_dispatched` (409) — al recibir respuesta del cliente sobre una intervención que aún no fue enviada
- `setting_not_found` (404)
- `setting_value_invalid` (400) — el valor no pasa la validación del setting
- `nps_score_invalid` (400) — score fuera de 0-10

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

- Repo creado con la estructura de carpetas del `plan.md`
- Supabase project creado y conectado
- Todas las tablas de la sección 1 creadas con sus índices:
  - `csm_team`
  - `accounts` (con `account_number`, `csm_id` FK + columnas NPS denormalizadas)
  - `usage_events`, `tickets`, `conversations`
  - `nps_responses`
  - `interventions` (con `requires_approval`, `approved_by`, status enum extendido)
  - `playbook_memory`
  - `historical_deals`
  - `account_health_snapshot`
  - `account_health_history`
  - `system_settings` (con seed inicial)
- `.env.example` con todas las variables documentadas
- Endpoints stub de FastAPI creados (devuelven mock pero la firma está):
  - Accounts (2.1)
  - CSM Team (2.6)
  - NPS (2.7)
  - Health History (2.8)
  - Approvals (2.9) — coordinar con Persona 2
  - Settings (2.10)
  - Customer Response Webhook (3.6) — coordinar con Persona 3
- Documento `CONTRACTS.md` (este) commiteado en main
- Mensaje al equipo: "contratos listos, pueden empezar capa 2/3/4"

---

## 10. Cómo proponer cambios a este documento

1. Crear branch `persona-N/contracts-update-{descripcion}`
2. Editar `CONTRACTS.md`
3. PR con descripción del cambio + impacto en otras capas
4. Review obligatorio de Persona 1 + una persona afectada
5. Merge → notificar al equipo en el canal

**No cambies este documento sin avisar.** Si alguien depende de un contrato y lo cambias en silencio, rompés el sistema.

---

**Última actualización:** Endpoints de solo lectura `GET /accounts/health-history` y `GET /accounts/{account_id}/health-history` (§2.1). Cambios anteriores: columna y API `champion_phone` / `champion.phone` en `accounts`; `account_number` e índice único; `csm_team`, `nps_responses`, `account_health_history`, `system_settings`, flujo de aprobación humana en `interventions` y webhook inbound (3.6).
**Próxima revisión:** Después del kickoff, cuando los 4 lo lean y propongan ajustes. Revisión obligatoria de Persona 2 (campo `requires_approval` en output del Intervention Engine + nuevo tool `get_nps_history` opcional) y Persona 3 (sección 3.6 customer-response webhook).