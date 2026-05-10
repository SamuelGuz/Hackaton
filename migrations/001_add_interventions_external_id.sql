-- 001_add_interventions_external_id.sql
-- Propósito: soportar voice_call (Twilio) — guardar Call SID y callbacks sin error PGRST204.
-- Aplicar en Supabase → SQL Editor (proyecto correcto).

ALTER TABLE public.interventions
ADD COLUMN IF NOT EXISTS external_id text;

COMMENT ON COLUMN public.interventions.external_id IS
  'ID externo del canal (ej. Twilio Call SID para voice_call PSTN).';

CREATE INDEX IF NOT EXISTS idx_interventions_external_id
  ON public.interventions (external_id)
  WHERE external_id IS NOT NULL;
