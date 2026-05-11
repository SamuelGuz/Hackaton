# Churn Oracle



Churn Oracle es un sistema end-to-end que anticipa riesgo de abandono, detecta oportunidades de expansión y **ejecuta intervenciones reales** (email, Slack, WhatsApp, voz) con **aprendizaje cerrado** sobre qué playbooks funcionan para cada perfil de cuenta.

---

## Enlaces en vivo

| Qué | Enlace |
|-----|--------|
| **Dashboard Churn Oracle** | [https://hack.dark-army.lat/](https://hack.dark-army.lat/) |
| **Demo SaaS** (aplicación de ejemplo que se conecta a Churn Oracle vía API) | [https://demosaas.dark-army.lat/](https://demosaas.dark-army.lat/) |

La demo SaaS representa cómo un producto B2B de un cliente podría **integrarse por API**: enviar eventos de uso, contexto de cuenta o disparadores y consumir respuestas del orquestador (salud, intervenciones sugeridas, etc.) sin abandonar su propia marca ni su stack.

---

## Resumen de la aplicación

| Capa | Rol |
|------|-----|
| **Datos** | Cuentas, uso, tickets, NPS, historial de salud y equipo CSM en Supabase (Postgres). |
| **Inteligencia** | Motor de intervenciones con LLM, playbooks versionados y memoria de éxito por segmento. |
| **Acción** | Dispatch multi-canal vía Make y voz (ElevenLabs ConvAI / Twilio según configuración). |
| **Experiencia** | Frontend React + Vite para salud de cuentas, aprobaciones y demo en vivo. |

El dominio de negocio simulado es **Acme SaaS Inc.**: un SaaS B2B con clientes en varias industrias, ARR, asientos y renovaciones modelados de forma coherente con señales de riesgo y expansión.

---

## Impacto

Las empresas B2B SaaS suelen perder una fracción importante del ARR por **churn silencioso**: el cliente se va sin una conversación clara, y el equipo de Customer Success entra tarde. En paralelo, las oportunidades de **upsell y cross-sell** se diluyen cuando nadie prioriza señales débiles pero consistentes (uso al límite del plan, conversaciones positivas sin seguimiento, etc.).

Churn Oracle ataca ese vacío con impacto medible en tres ejes:

1. **Anticipación** — Modela salud de cuenta y tendencias (NPS, uso, tickets, QBR) para acercar la conversación **antes** del punto de no retorno, no después del aviso de cancelación.
2. **Revenue protegido y movido** — Intervenciones orientadas a **retención** (riesgo de churn) y a **expansión** (seats, plan, add-ons), alineadas con el playbook que mejor encaja con el perfil de la cuenta.
3. **Escala sin perder el hilo** — El CSM deja de reconstruir contexto en hojas y correos: el sistema propone acciones con **razonamiento visible** (`agent_reasoning`), respeta **aprobación humana** cuando el riesgo o el ARR lo exigen, y registra **resultados** para mejorar la próxima decisión.

En términos de negocio: menos reacción a fuegos artificiales y más **pipeline de retención y expansión** gobernado por datos y por aprendizaje acumulado.

---

## Ejecución

La solución está pensada para **correr en vivo**, no como mockup aislado:

- **Backend** — Python + **FastAPI** (`/backend`), prefijo de API `/api/v1`, errores con códigos y mensajes consistentes con el contrato del proyecto.
- **Frontend** — **React + Vite** (`/frontend`) para visualizar cuentas, intervenciones y flujos de aprobación.
- **Base de datos** — **Supabase** (Postgres, UUIDs como claves primarias), esquemas y endpoints documentados en `CONTRACTS.md`.
- **Automatización externa** — Webhooks **Make** para Gmail, Slack y WhatsApp (variables `MAKE_WEBHOOK_*` en `.env.example`).
- **Voz** — **ElevenLabs** (ConvAI) y opcionalmente **Twilio** para puente PSTN, con URLs públicas del API para callbacks y WebSocket según despliegue.

Flujo típico de una intervención:

1. El motor genera la intervención y decide si requiere aprobación.
2. FastAPI persiste el estado (`pending`, `pending_approval`, etc.) según reglas de `system_settings` (p. ej. auto-aprobación por ARR y confianza).
3. Tras aprobación, **`POST /dispatch-intervention`** valida el estado y enruta al canal (Make o voz según configuración).
4. Los resultados alimentan el **closed-loop** (playbook memory y tasas de éxito).

Para levantar el entorno de desarrollo, copia `.env.example` a `.env`, rellena claves y URLs, y sigue la convención del repo: **snake_case** en JSON y Python; contratos primero en `CONTRACTS.md` si algo cambia.

---



## Automatización

La automatización no es un script one-shot: es un **sistema reutilizable** con reglas explícitas:

- **Detección** — Señales continuas (uso, tickets, conversaciones, NPS, historial de salud) alimentan scores y triggers sin intervención manual por cuenta.
- **Enrutado** — `channel_router` y dispatch centralizan **qué** se envía **por dónde**, respetando aprobaciones y conflictos (p. ej. no despachar si la intervención no está en `pending`).
- **Integraciones** — Make actúa como capa de conectores; el backend mantiene la **verdad del estado** y los contratos.
- **Ajuste fino sin redeploy** — *Toggles* globales (auto-aprobación, umbrales de ARR y confianza) permiten calibrar el grado de autonomía sin reescribir la lógica de negocio.

Objetivo: que el mismo despliegue sirva para demo, piloto y iteración, con trazabilidad de cada paso.

---

## Vídeos del proyecto


###  recorrido 1

[![Ver en YouTube — Churn Oracle (miniatura)](https://img.youtube.com/vi/nLT-ZTjv2II/maxresdefault.jpg)](https://www.youtube.com/watch?v=nLT-ZTjv2II)

**Enlace directo:** [https://www.youtube.com/watch?v=nLT-ZTjv2II](https://www.youtube.com/watch?v=nLT-ZTjv2II)

---

###  recorrido 2

[![Ver en YouTube — Churn Oracle (miniatura)](https://img.youtube.com/vi/Fz7hXGwgUJ8/maxresdefault.jpg)](https://www.youtube.com/watch?v=Fz7hXGwgUJ8)

**Enlace directo:** [https://www.youtube.com/watch?v=Fz7hXGwgUJ8](https://www.youtube.com/watch?v=Fz7hXGwgUJ8)

---

###  recorrido 3

[![Ver en YouTube — Churn Oracle (miniatura)](https://img.youtube.com/vi/27zlMXiJ4zQ/maxresdefault.jpg)](https://www.youtube.com/watch?v=27zlMXiJ4zQ)

**Enlace directo:** [https://www.youtube.com/watch?v=27zlMXiJ4zQ](https://www.youtube.com/watch?v=27zlMXiJ4zQ)



---

## Documentación para el equipo

| Archivo | Contenido |
|---------|-----------|
| [`plan.md`](plan.md) | Plan de ejecución, arquitectura y criterios del hackathon. |
| [`CONTRACTS.md`](CONTRACTS.md) | Esquemas de DB, APIs y webhooks — **fuente única de verdad**. |
| [`claude.md`](claude.md) | Instrucciones para agentes de código y ownership por capa. |

**Reglas críticas para contribuir:** no inventar campos fuera de `CONTRACTS.md`; usar **snake_case** en API y base de datos; si cambia el contrato, actualizar `CONTRACTS.md` **antes** que el código.

---

## Estructura del repositorio

```
backend/     # FastAPI, agentes, dispatch, datos
frontend/    # React + Vite + Tailwind
docs/        # Guías (API, ElevenLabs, plantillas de rol)
```

---

*Churn Oracle — GTM Hackathon · Retain & Expand · End-to-end beats polished.*
