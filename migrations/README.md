# Migraciones SQL (trazabilidad)

Esta carpeta registra **cambios incrementales** sobre la base de datos (Supabase/Postgres). Cada archivo es **idempotente** cuando tiene sentido (`IF NOT EXISTS`, etc.).

## Cómo aplicarlas

1. Abre el **SQL Editor** en el proyecto Supabase correcto.
2. Ejecuta los archivos **en orden numérico** (`001_`, `002_`, …).
3. Anota en tu PR/commit qué migraciones ya corrieron en cada entorno (dev/staging/prod).

## Convención de nombres

- `NNN_descripcion_corta.sql` — número de 3 dígitos para orden estable.
- Un cambio lógico por archivo cuando sea posible.

## Historial

| Archivo | Descripción |
|---------|-------------|
| `001_add_interventions_external_id.sql` | Columna `external_id` en `interventions` (p. ej. Call SID de Twilio). |
