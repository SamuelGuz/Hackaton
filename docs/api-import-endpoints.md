# API de Registro e Importación (Accounts + Data Relacionada)

Esta guía documenta los endpoints nuevos para:
- crear cuentas individuales
- consultar historial de salud (`account_health_history`, solo lectura)
- importar cuentas en lote
- importar `usage_events`, `tickets` y `conversations` en endpoints separados

## Base URL y autenticación

- Base URL local: `http://localhost:8000/api/v1`
- Header obligatorio en endpoints de escritura:
  - `X-API-Key: <API_KEY>`
- La variable `API_KEY` debe existir en el entorno del backend.

Ejemplo base:

```bash
curl -X POST "http://localhost:8000/api/v1/accounts" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d '{}'
```

## Health history (solo lectura)

Endpoints alineados con `CONTRACTS.md` §2.1. No requieren `X-API-Key` (mismo criterio que `GET /accounts`).

### `GET /accounts/health-history`

Lista paginada global con filtros opcionales:

| Parámetro      | Descripción |
|----------------|-------------|
| `account_id`   | UUID de cuenta |
| `health_status`| `critical`, `at_risk`, `stable`, `healthy`, `expanding` |
| `from`         | `computed_at` mayor o igual (ISO 8601) |
| `to`           | `computed_at` menor o igual (ISO 8601) |
| `limit`        | default 100, máx 500 |
| `offset`       | default 0 |

### `GET /accounts/{account_id}/health-history`

Misma respuesta y filtros que el global (excepto `account_id` en query), acotado a la cuenta. **404** si `account_id` no existe.

### Respuesta (forma común)

```json
{
  "items": [
    {
      "id": "uuid",
      "account_id": "uuid",
      "health_status": "stable",
      "churn_risk_score": 25,
      "expansion_score": 30,
      "top_signals": [],
      "predicted_churn_reason": null,
      "crystal_ball_confidence": null,
      "computed_at": "2026-05-10T12:00:00+00:00",
      "computed_by_version": "account-create-v1"
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

### cURL (ejemplos)

```bash
# Global, primera página
curl -s "http://localhost:8000/api/v1/accounts/health-history?limit=50&offset=0"

# Por cuenta y rango de fechas
curl -s "http://localhost:8000/api/v1/accounts/1f42f72c-6f32-40e8-94a1-e880a7987f66/health-history?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z"
```

## 1) Crear cuenta individual

### `POST /accounts`

Crea una cuenta y también inicializa:
- `account_health_snapshot`
- `account_health_history`

Si `account_number` ya existe, no falla con 409: responde `skipped=true`.

### Body (ejemplo)

```json
{
  "account_number": "ACC-2026-09999",
  "name": "Nova Analytics",
  "industry": "fintech",
  "size": "mid_market",
  "geography": "latam",
  "plan": "growth",
  "arr_usd": 42000,
  "seats_purchased": 120,
  "seats_active": 77,
  "signup_date": "2025-06-01T00:00:00Z",
  "contract_renewal_date": "2026-11-01T00:00:00Z",
  "champion_name": "Ana Torres",
  "champion_email": "ana@nova.com",
  "champion_role": "Head of Ops",
  "champion_phone": "+5215511111111",
  "champion_changed_recently": false,
  "csm_id": "6f0ec3bf-2a44-4a43-9f4b-11f0ba71d0be",
  "last_qbr_date": "2026-01-15T00:00:00Z",
  "current_nps_score": 8,
  "current_nps_category": "passive",
  "last_nps_at": "2026-02-10T00:00:00Z",
  "health": {
    "churn_risk_score": 31,
    "expansion_score": 52,
    "health_status": "stable",
    "predicted_churn_reason": null,
    "crystal_ball_reasoning": "Cuenta creada por API."
  }
}
```

### cURL

```bash
curl -X POST "http://localhost:8000/api/v1/accounts" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d @create-account.json
```

### Response (insertado)

```json
{
  "inserted": true,
  "skipped": false,
  "account_id": "1f42f72c-6f32-40e8-94a1-e880a7987f66",
  "message": "Cuenta creada correctamente"
}
```

### Response (duplicado por `account_number`)

```json
{
  "inserted": false,
  "skipped": true,
  "account_id": "1f42f72c-6f32-40e8-94a1-e880a7987f66",
  "message": "Cuenta omitida: account_number ya existe"
}
```

## 2) Import masivo de accounts (JSON)

### `POST /accounts/import`

Recibe `accounts: []` con hasta 1000 filas.

- Dedupe por `account_number`
- Si existe: `skipped`
- Si hay error de fila: se reporta en `errors` y continúa el lote
- Cada cuenta insertada crea snapshot/history inicial

### Body (ejemplo)

```json
{
  "accounts": [
    {
      "account_number": "ACC-2026-10001",
      "name": "Blue Loop",
      "industry": "edtech",
      "size": "smb",
      "geography": "latam",
      "plan": "starter",
      "arr_usd": 12000,
      "seats_purchased": 40,
      "seats_active": 27,
      "signup_date": "2025-02-01T00:00:00Z",
      "contract_renewal_date": "2026-10-01T00:00:00Z",
      "champion_name": "Laura Sol",
      "champion_email": "laura@blueloop.com",
      "champion_role": "Customer Ops",
      "csm_assigned": "Carlos López",
      "churn_risk_score": 35,
      "expansion_score": 49,
      "health_status": "stable"
    }
  ]
}
```

### cURL

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d @import-accounts.json
```

### Response (ejemplo)

```json
{
  "inserted": 1,
  "skipped": 0,
  "errors": [],
  "inserted_ids": ["70e2aa67-c6aa-4d71-ac3c-1f2ef16ad3cc"]
}
```

## 3) Import masivo de accounts (archivo CSV/XLSX)

### `POST /accounts/import/file`

Formato `multipart/form-data` con campo `file`.

### cURL

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import/file" \
  -H "X-API-Key: TU_API_KEY" \
  -F "file=@accounts.xlsx"
```

Headers de columnas recomendadas para archivo:
- `account_number`, `name`, `industry`, `size`, `geography`, `plan`
- `arr_usd`, `seats_purchased`, `seats_active`
- `signup_date`, `contract_renewal_date`
- `champion_name`, `champion_email`, `champion_role`, `champion_phone`
- `csm_id` o `csm_assigned`
- opcionales: `churn_risk_score`, `expansion_score`, `health_status`, `predicted_churn_reason`, `crystal_ball_reasoning`

## 4) Import de usage events

### `POST /accounts/import/usage-events`
### `POST /accounts/import/usage-events/file`

Reglas:
- Referencia por `account_id` o `account_number`
- Duplicado detectado por llave compuesta natural:
  - `account` + `event_type` + `occurred_at` + `feature_name` + `user_email`
- Duplicado en related data se reporta como error por fila (no `skipped`)

### Body JSON (ejemplo)

```json
{
  "rows": [
    {
      "account_number": "ACC-2026-10001",
      "event_type": "feature_used",
      "feature_name": "forecast_dashboard",
      "user_email": "ana@nova.com",
      "occurred_at": "2026-05-09T15:00:00Z",
      "metadata": {
        "workspace": "latam-core"
      }
    }
  ]
}
```

### cURL JSON

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import/usage-events" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d @usage-events.json
```

### cURL archivo

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import/usage-events/file" \
  -H "X-API-Key: TU_API_KEY" \
  -F "file=@usage-events.csv"
```

## 5) Import de tickets

### `POST /accounts/import/tickets`
### `POST /accounts/import/tickets/file`

Reglas de duplicado natural:
- `account` + `subject` + `status` + `opened_at`

### Body JSON (ejemplo)

```json
{
  "rows": [
    {
      "account_id": "1f42f72c-6f32-40e8-94a1-e880a7987f66",
      "subject": "Error en reportes semanales",
      "description": "Los reportes no cargan en horas pico.",
      "priority": "high",
      "status": "open",
      "sentiment": "negative",
      "opened_at": "2026-05-08T09:30:00Z",
      "resolved_at": null,
      "first_response_hours": 1.5
    }
  ]
}
```

### cURL JSON

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import/tickets" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d @tickets.json
```

### cURL archivo

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import/tickets/file" \
  -H "X-API-Key: TU_API_KEY" \
  -F "file=@tickets.xlsx"
```

## 6) Import de conversations

### `POST /accounts/import/conversations`
### `POST /accounts/import/conversations/file`

Reglas de duplicado natural:
- `account` + `channel` + `direction` + `occurred_at` + `content`

Para archivos, `participants` puede venir como texto separado por `,` o `;`.

### Body JSON (ejemplo)

```json
{
  "rows": [
    {
      "account_number": "ACC-2026-10001",
      "channel": "email",
      "direction": "inbound",
      "participants": ["ana@nova.com", "csm@empresa.com"],
      "subject": "Necesitamos ayuda con onboarding",
      "content": "Estamos teniendo fricción en la activación del equipo.",
      "sentiment": "neutral",
      "occurred_at": "2026-05-07T18:45:00Z"
    }
  ]
}
```

### cURL JSON

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import/conversations" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d @conversations.json
```

### cURL archivo

```bash
curl -X POST "http://localhost:8000/api/v1/accounts/import/conversations/file" \
  -H "X-API-Key: TU_API_KEY" \
  -F "file=@conversations.csv"
```

## 7) Respuestas de error comunes

### Auth inválida

```json
{
  "error": "unauthorized",
  "message": "Invalid or missing X-API-Key",
  "details": {}
}
```

### Error de validación (422)

```json
{
  "error": "validation_error",
  "message": "Request validation failed",
  "details": {
    "errors": []
  }
}
```

### Error por fila en import relacionado (ejemplo)

```json
{
  "inserted": 1,
  "errors": [
    {
      "row_index": 2,
      "key": "ACC-2026-10001",
      "message": "Duplicado en usage_events por llave compuesta natural"
    }
  ]
}
```

