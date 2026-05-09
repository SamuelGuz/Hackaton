# CHURN ORACLE — Plan de Ejecución

> **GTM Hackathon · Stage: Retain & Expand**
> Equipo: 4 personas · Modo: Remoto · Demo: 1:30 min interactivo

---

## 1. Resumen ejecutivo

### El problema
Las empresas B2B SaaS pierden 10-20% de su revenue anual por clientes que se van sin avisar. Customer Success reacciona en vez de prevenir, las oportunidades de expansión se pierden, y el conocimiento de "qué funciona con qué cliente" muere con cada CSM que se va.

### Lo que construimos
**Churn Oracle** es un agente autónomo que cubre la etapa Retain & Expand del funnel:
1. Detecta riesgo de churn 90 días antes (Crystal Ball)
2. Detecta oportunidades de expansion automáticamente (Expansion Trigger)
3. Centraliza señales por cuenta (Health Dashboard)
4. **[Diferenciador 1]** Ejecuta intervenciones reales en múltiples canales (Email, Slack, WhatsApp, Voz clonada)
5. **[Diferenciador 2]** Aprende de cada intervención y refina su playbook automáticamente (Closed-Loop Learning)

### Por qué gana
- Cubre los 3 features que el brief pide explícitamente
- Agrega 2 diferenciadores que ningún equipo va a tener (acción multi-canal real + aprendizaje en vivo)
- End-to-end real, no mockup
- Demo interactivo que el juez puede tocar

---

## 2. Criterios del hackathon (recordatorio)

| Criterio | Cómo lo atacamos |
|---|---|
| **Impact** (5 pts) | Reducción de churn medible + expansion triggered = revenue movido |
| **Execution** (5 pts) | Sistema corre live, mensajes llegan en tiempo real durante el demo |
| **Creativity** (5 pts) | Closed-loop learning + voz clonada para Retain (no Find/Apollo redux) |
| **Automation** (5 pts) | Sistema reutilizable que aprende; no es one-shot |
| **Presentation** (5 pts) | 1:30 min cronometrado, momento wow en los primeros 30 segundos |

**Mantra del brief:** *"End-to-end beats polished" · "Pipeline OR revenue. Anything else: SKIP"*

---

## 3. Arquitectura del sistema

### Vista de capas

```
┌─────────────────────────────────────────────────────────┐
│  CAPA 5 — FRONTEND (React)                              │
│  Dashboard interactivo · Lista de cuentas · Acciones    │
└─────────────────────────────────────────────────────────┘
                          ▲ ▼
┌─────────────────────────────────────────────────────────┐
│  CAPA 4 — APRENDIZAJE (Closed-Loop)                     │
│  Playbook memory · Resultado de intervenciones          │
└─────────────────────────────────────────────────────────┘
                          ▲ ▼
┌─────────────────────────────────────────────────────────┐
│  CAPA 3 — ACCIÓN (Make + ElevenLabs)                    │
│  Email · Slack · WhatsApp · Voz clonada                 │
└─────────────────────────────────────────────────────────┘
                          ▲ ▼
┌─────────────────────────────────────────────────────────┐
│  CAPA 2 — AGENTES (FastAPI + LLM)                       │
│  Crystal Ball · Expansion · Intervention Engine         │
└─────────────────────────────────────────────────────────┘
                          ▲ ▼
┌─────────────────────────────────────────────────────────┐
│  CAPA 1 — DATOS (Supabase)                              │
│  200 cuentas sintéticas · Histórico · Playbooks         │
└─────────────────────────────────────────────────────────┘
```

### Stack técnico

| Componente | Tecnología |
|---|---|
| Base de datos | Supabase (Postgres) |
| Backend | Python + FastAPI |
| Frontend | React (Vite + Tailwind) |
| LLM | Claude API (sonnet 4.6 para razonamiento, haiku para tareas rápidas) |
| Automatizaciones | Make |
| Voz | ElevenLabs |
| Hosting backend | Railway o Render |
| Hosting frontend | Vercel |
| Repo | GitHub (público) |

---

## 4. Roles y división de trabajo

> **Regla de oro:** cada persona es dueña de una capa con interfaces claras hacia las demás. Si saben qué inputs reciben y qué outputs entregan, pueden trabajar en paralelo sin tocar el código del otro.

### PERSONA 1 — Data & Backend Foundation Owner

**Responsabilidad:** Capa 1 + infraestructura compartida + endpoints base de FastAPI.

**Tareas:**
- [ ] Setup del repo en GitHub (estructura de carpetas, README, .gitignore, .env.example)
- [ ] Crear proyecto Supabase y configurar tablas según `CONTRACTS.md`
- [ ] Diseñar y escribir el documento `CONTRACTS.md` (esquemas de datos, contratos entre capas) — **ESTO ES LO PRIMERO**
- [ ] Generar dataset sintético de 200 cuentas usando Claude API
  - 200 perfiles de empresa con personalidad (industria, tamaño, geografía, plan, ARR)
  - Historia de uso por cuenta (logins, features, tickets) con patrones realistas
  - Sembrar señales en cuentas en riesgo (caída de logins, ticket sin resolver, champion change)
  - 50 deals históricos ganados/perdidos con conversaciones realistas
- [ ] Subir el dataset a Supabase
- [ ] Setup FastAPI base con endpoints CRUD sobre las cuentas
- [ ] Endpoint `/accounts` (lista), `/accounts/{id}` (detalle), `/accounts/{id}/history` (timeline)
- [ ] Configurar deployment del backend (Railway/Render)
- [ ] Soporte cross-team: cuando otros se traben con queries o estructura de datos

**Output esperado:** Repo + Supabase con data poblada + API funcionando + `CONTRACTS.md` documentado.

**Entregables clave:**
1. `CONTRACTS.md` con schemas exactos
2. 200 cuentas sintéticas en Supabase
3. API base desplegada con endpoints documentados

---

### PERSONA 2 — Agents & Intelligence Owner

**Responsabilidad:** Capa 2 + Capa 4 (los 3 agentes principales + closed-loop learning).

**Tareas:**
- [ ] **Crystal Ball Agent** (Detección de riesgo)
  - Lee historia de cuenta desde Supabase
  - Identifica señales de churn (uso, tickets, conversaciones)
  - Asigna score 0-100 con justificación
  - Genera explicación de por qué está en riesgo
  - Output estructurado: `{score, top_signals, predicted_churn_reason, confidence}`

- [ ] **Expansion Agent** (Detección de oportunidad)
  - Lee uso del producto y plan actual
  - Identifica cuentas listas para upgrade
  - Genera playbook con razón específica ("creció 3x en logins, plan se quedó chico")
  - Output: `{ready_to_expand: bool, recommended_plan, justification, suggested_message}`

- [ ] **Intervention Engine**
  - Decide QUÉ intervención lanzar para cada cuenta en riesgo
  - Consulta el playbook memory (Capa 4) para usar lo que funcionó antes con perfiles similares
  - Genera contenido personalizado (email, mensaje de Slack, script de voz)
  - Output: `{channel, message, recipient, urgency, playbook_id_used}`

- [ ] **Closed-Loop Learning System** (EL DIFERENCIADOR)
  - Tabla `playbook_memory` en Supabase con: perfil_cuenta + señal + intervención + resultado
  - Cada vez que una intervención se ejecuta, registra el outcome
  - Cuando el agente decide la próxima intervención, consulta esta memoria
  - Sistema de scoring: "playbook X funcionó 70% en perfiles similares" → upweight
  - **Visualizable en frontend:** mostrar antes/después del aprendizaje

**Output esperado:** 3 agentes funcionando que leen Supabase, razonan con Claude, y escriben de vuelta. Closed-loop documentado y demostrable.

**Entregables clave:**
1. 3 endpoints FastAPI: `/agents/crystal-ball/{account_id}`, `/agents/expansion/{account_id}`, `/agents/intervention/{account_id}`
2. Sistema de playbook memory con al menos 10 playbooks pre-cargados
3. Demo del aprendizaje: ejecutar intervención A → marcar resultado → próxima decisión usa el resultado

---

### PERSONA 3 — Automation & Voice Owner

**Responsabilidad:** Capa 3 (Make + ElevenLabs + integraciones de canales).

**Tareas:**
- [ ] **Setup de Make**
  - Workflow 1: Trigger desde FastAPI → Email a destinatario configurable
  - Workflow 2: Trigger desde FastAPI → Mensaje de Slack al canal del equipo
  - Workflow 3: Trigger desde FastAPI → Mensaje de WhatsApp (Twilio o WhatsApp Business API)
  - Workflow 4: Trigger desde FastAPI → Llamada con audio generado por ElevenLabs

- [ ] **Integración ElevenLabs**
  - Clonar una voz para usar en las llamadas (voz del "CSM ficticio")
  - Endpoint que recibe texto del Intervention Engine y devuelve audio
  - Storage del audio generado (Supabase storage o similar)
  - Reproducción del audio durante el demo (puede ser embebido en frontend o llamada real vía Twilio)

- [ ] **Channel Router (en FastAPI)**
  - Endpoint `/dispatch-intervention` que recibe `{account_id, channel, message}` y dispara el workflow correspondiente en Make
  - Manejo de errores y logging
  - Registrar cada intervención lanzada en Supabase para feedback al closed-loop

- [ ] **FALLBACK CRÍTICO**
  - Audio pre-grabado de respaldo: si ElevenLabs falla en el demo, hay un audio listo para reproducir
  - Email/Slack template hardcodeado de respaldo si Make se cae
  - Documentar el fallback paso a paso en un runbook

**Output esperado:** Disparar una intervención desde el frontend hace llegar email + Slack + WhatsApp + voz a destinos reales en menos de 30 segundos.

**Entregables clave:**
1. 4 workflows de Make funcionando y conectados a FastAPI
2. Voz clonada en ElevenLabs lista para usar
3. Runbook de fallbacks documentado

---

### PERSONA 4 — Frontend & Demo Owner

**Responsabilidad:** Capa 5 (Frontend React) + presentación + guión del demo.

**Tareas:**
- [ ] **Setup frontend**
  - Vite + React + Tailwind
  - Conexión a FastAPI (variables de entorno)
  - Deployment en Vercel

- [ ] **Vista 1: Lista de cuentas (Health Dashboard global)**
  - Tabla con 200 cuentas: nombre, ARR, score de riesgo, score de expansion, último contacto
  - Filtros: solo en riesgo, solo expansion ready, todas
  - Indicadores visuales (rojo/amarillo/verde para riesgo)

- [ ] **Vista 2: Detalle de cuenta (Health Dashboard por cuenta)**
  - Toda la info en una pantalla: uso, tickets, contrato, conversaciones recientes
  - Timeline de eventos
  - Score de riesgo con explicación generada por Crystal Ball
  - Score de expansion con playbook propuesto
  - Botón GRANDE: "Ejecutar intervención"

- [ ] **Vista 3: Modal de intervención**
  - Muestra qué canal, qué mensaje, a quién
  - Permite editar el mensaje antes de lanzar
  - Botón "Lanzar" → llama `/dispatch-intervention` → muestra estado en vivo
  - Confirmación visual cuando cada canal entrega (email ✓, Slack ✓, WhatsApp ✓, Voz ✓)

- [ ] **Vista 4: Closed-Loop Visualization (EL MOMENTO WOW)**
  - Pantalla que muestra el playbook memory
  - "Antes del aprendizaje: agente proponía X. Después de 10 intervenciones: agente propone Y"
  - Mostrar la justificación del cambio de comportamiento
  - Animación o transición clara para que el juez lo entienda en 5 segundos

- [ ] **Guión del demo (1:30 min cronometrado)**
  - 0:00-0:15 — "Las empresas pierden 15% de revenue al año por churn que nadie ve venir"
  - 0:15-0:30 — Mostrar dashboard con 200 cuentas, 12 en riesgo
  - 0:30-0:50 — Click en cuenta crítica, mostrar Health Dashboard + score con explicación
  - 0:50-1:10 — Click "Ejecutar intervención" → email/Slack/WhatsApp/voz llegan en vivo
  - 1:10-1:25 — Mostrar Closed-Loop: "El agente aprende de cada resultado y refina"
  - 1:25-1:30 — Cierre: "Crystal Ball + Expansion + Health Dashboard + acción real + aprendizaje"

- [ ] **Pre-cocinar el demo**
  - Identificar las 3 cuentas exactas que se van a mostrar
  - Asegurar que la cuenta principal tenga señales obvias y resultado dramático
  - Probar el demo 5 veces seguidas antes de presentar

**Output esperado:** Frontend desplegado en Vercel, demo cronometrado, momento wow visible.

**Entregables clave:**
1. App React desplegada en Vercel
2. 4 vistas funcionando contra el backend real
3. Guión del demo escrito y cronometrado

---

## 5. CONTRACTS.md — Lo primero que hacemos

> **Persona 1 escribe esto en las primeras 2 horas. Sin esto, las otras 3 personas no pueden empezar.**

### Schema mínimo a definir

**Tabla `accounts`**
```
id, name, industry, size, geography, plan, arr, signup_date,
champion_name, champion_email, csm_assigned, last_qbr_date
```

**Tabla `usage_events`**
```
id, account_id, event_type, timestamp, metadata
(event_type: login, feature_used, ticket_opened, ticket_resolved, etc.)
```

**Tabla `conversations`**
```
id, account_id, channel, direction, content, timestamp, sentiment
```

**Tabla `interventions`**
```
id, account_id, channel, message, status, sent_at, outcome, outcome_recorded_at
```

**Tabla `playbook_memory`**
```
id, account_profile, signal_pattern, intervention_used, outcome,
success_rate, sample_size, last_updated
```

**Tabla `historical_deals`**
```
id, account_profile, status (won/lost), reason, conversation_summary, lessons
```

### Contratos entre capas

- **Capa 1 → Capa 2:** Persona 2 lee de Supabase vía API de Persona 1, NO consulta Supabase directo
- **Capa 2 → Capa 3:** Persona 3 expone webhook genérico que recibe `{account_id, channel, message, recipient}`
- **Capa 3 → Capa 1:** Persona 3 escribe el resultado en tabla `interventions` para que el closed-loop lo consuma
- **Capa 5 → Backend:** Persona 4 consume solo endpoints de FastAPI, nunca toca Supabase directo

---

## 6. Estructura del repositorio

```
churn-oracle/
├── README.md
├── CONTRACTS.md              ← Documento sagrado (Persona 1)
├── plan.md                   ← Este archivo
├── .gitignore
├── .env.example
│
├── /backend                  ← Python + FastAPI
│   ├── main.py
│   ├── requirements.txt
│   ├── /data                 ← Persona 1
│   │   ├── synthetic_generator.py
│   │   ├── seed_database.py
│   │   └── schemas.py
│   ├── /agents               ← Persona 2
│   │   ├── crystal_ball.py
│   │   ├── expansion.py
│   │   ├── intervention_engine.py
│   │   └── learning_loop.py
│   ├── /automations          ← Persona 3
│   │   ├── channel_router.py
│   │   ├── elevenlabs_client.py
│   │   └── make_webhooks.py
│   └── /shared
│       ├── supabase_client.py
│       └── claude_client.py
│
├── /frontend                 ← Persona 4
│   ├── package.json
│   ├── vite.config.ts
│   ├── /src
│   │   ├── pages/
│   │   ├── components/
│   │   ├── api/
│   │   └── App.tsx
│   └── demo-script.md
│
└── /docs
    ├── runbook-fallbacks.md
    └── demo-flow.md
```

---

## 7. Flujo de Git para no romperse

### Branches

```
main                                    (siempre desplegable)
├── persona-1/contracts-and-data
├── persona-1/api-foundation
├── persona-2/crystal-ball
├── persona-2/expansion-agent
├── persona-2/closed-loop
├── persona-3/make-integration
├── persona-3/elevenlabs-voice
├── persona-4/dashboard-mvp
└── persona-4/demo-views
```

### Reglas

1. **Branches con prefijo de persona** (`persona-1/`, `persona-2/`...) — evita conflictos de nombres
2. **PRs a main requieren review de UNA persona más** (no más, perdés tiempo)
3. **No commits directos a main** después de la primera hora de setup
4. **Si hay conflicto, se resuelve en tu branch**, no en main
5. **Tags de milestones:**
   - `v0.1-data-ready` (Persona 1 terminó data)
   - `v0.2-agents-working` (Persona 2 terminó core)
   - `v0.3-channels-live` (Persona 3 terminó canales)
   - `v0.4-frontend-mvp` (Persona 4 terminó UI base)
   - `v1.0-demo-ready` (todo integrado)

---

## 8. Mocks para no bloquearse

Mientras Persona 1 termina la data y la API:

- **Persona 2** trabaja con un JSON mock de cuenta que sigue el contrato → al terminar Persona 1, swap es trivial
- **Persona 3** trabaja con un endpoint fake que devuelve `{message, channel, recipient}` hardcoded
- **Persona 4** trabaja con `mockAccounts.json` en el frontend → cuando la API esté lista, cambia el fetch

**Regla:** Nadie espera. Si te bloqueás, hacé mock y avanzá.

---

## 9. Sincronización del equipo

### Standups
- **Cada 4 horas, 15 minutos máximo, en pie (o de pie en remoto: video on)**
- 3 preguntas por persona:
  1. ¿Qué terminé desde el último standup?
  2. ¿Qué bloqueo tengo?
  3. ¿En qué estoy trabajando ahora?

### Comunicación
- Slack/Discord del equipo: canal único, sin sub-canales (somos 4 personas, no necesitamos jerarquía)
- Decisiones técnicas se documentan en el thread del PR
- Decisiones de producto se documentan en `/docs/decisions.md`

### Bug bash obligatorio
- A mitad del proyecto: 1 hora donde cada uno intenta romper el sistema del otro
- Antes del demo final: 1 hora donde se corre el demo end-to-end 5 veces seguidas

---

## 10. Riesgos identificados y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| ElevenLabs falla en demo | Media | Audio pre-grabado de fallback (responsabilidad: Persona 3) |
| Make rate limits | Media | Webhooks dedicados por canal, no encolar más de 1 por segundo |
| Supabase pausado por inactividad | Baja | Cron de health check cada 30 min |
| Closed-loop no se ve claro en demo | Alta | Persona 4 pre-cocina la visualización con animación clara |
| Data sintética se siente fake | Alta | Persona 1 valida con el equipo antes de seguir; iterar 2-3 veces |
| Latencia de Claude API mata el demo | Media | Pre-calcular scores de las cuentas que se van a mostrar; no llamar LLM en vivo durante el demo crítico |
| Frontend bonito pero sin funcionalidad | Media | "End-to-end beats polished": Persona 4 prioriza funcional sobre estético |

---

## 11. Criterios de "Done"

### MVP mínimo viable (lo que NO podemos no tener)
- [ ] 200 cuentas sintéticas en Supabase con historia realista
- [ ] Crystal Ball funcionando contra data real
- [ ] Expansion Agent funcionando contra data real
- [ ] Frontend con lista de cuentas + detalle
- [ ] Al menos 1 canal de intervención funcionando end-to-end (email)
- [ ] Demo de 1:30 cronometrado

### Versión competitiva (lo que nos hace ganar)
- [ ] MVP +
- [ ] 4 canales funcionando (Email + Slack + WhatsApp + Voz)
- [ ] Closed-Loop visualizable en frontend
- [ ] App desplegada con link público
- [ ] Repo público con README claro
- [ ] Fallbacks probados

### Versión que explota (si sobra tiempo)
- [ ] Above +
- [ ] Champion tracker (señal de LinkedIn público)
- [ ] What-if simulator interactivo
- [ ] Métricas en vivo: "12 intervenciones lanzadas, 8 con respuesta positiva"

---

## 12. Decisiones tomadas (no re-discutir)

- ✅ Stack: Python + FastAPI (backend), React + Vite (frontend), Supabase (DB)
- ✅ LLM: Claude API
- ✅ Automatizaciones: Make (no n8n)
- ✅ Voz: ElevenLabs
- ✅ Canales del demo: Email + Slack + WhatsApp + Voz
- ✅ Hosting: Vercel (frontend) + Railway/Render (backend)
- ✅ Demo: 1:30 min interactivo, juez puede tocar
- ✅ Entrega: link a app + repo público
- ✅ Roles: genéricos por ahora (Persona 1, 2, 3, 4)
- ✅ Equipo: 4 personas, remoto, todos expertos en LLMs/agentes

---

## 13. Lo primero que hace cada persona (hora 0)

| Persona | Primera tarea (críticas, antes de cualquier código) |
|---|---|
| **Persona 1** | Crear repo en GitHub + invitar a los 3 + escribir `CONTRACTS.md` borrador |
| **Persona 2** | Diseñar prompts iniciales para Crystal Ball y Expansion en un doc; revisar `CONTRACTS.md` apenas Persona 1 lo termine |
| **Persona 3** | Verificar accesos a Make, ElevenLabs, Twilio (si aplica para WhatsApp); clonar voz piloto |
| **Persona 4** | Wireframe rápido de las 4 vistas en Figma o papel; setup de Vite + Tailwind con repo |

**Reunión de kickoff (60 min antes de codear):**
1. Leer este `plan.md` completo (15 min)
2. Cada uno presenta qué entendió de su rol (10 min)
3. Decidir nombres específicos: ¿quién es Persona 1, 2, 3, 4? (5 min)
4. Definir canal de comunicación (5 min)
5. Persona 1 presenta borrador de `CONTRACTS.md` (15 min)
6. Acordar primer milestone y hora del primer standup (10 min)

---

## 14. Pitch de cierre (para internalizar)

> "El brief pide Crystal Ball, Expansion Trigger y Health Dashboard. Construimos los tres. Pero agregamos lo que ningún dashboard captura: un agente que ejecuta la intervención en cuatro canales reales — email, Slack, WhatsApp y voz clonada — y aprende del resultado para mejorar la próxima decisión. En noventa segundos van a ver una cuenta en riesgo detectada, una intervención multi-canal lanzada en vivo, y al agente cambiando su playbook frente a sus ojos. No es un modelo predictivo bonito. Es un sistema autónomo que mueve revenue."

---

**Última actualización:** Hora 0 del proyecto.
**Owners de actualización:** Persona 1 (data/api), Persona 4 (demo/frontend).