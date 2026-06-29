-- Fase 10 Universe — Webhook audit log + archivio eventi (retention)

CREATE TABLE IF NOT EXISTS public.universe_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.universe_events(id) ON DELETE SET NULL,
  entity_id UUID REFERENCES public.universe_entities(id) ON DELETE SET NULL,
  webhook_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  response_code INT,
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_universe_webhook_deliveries_user
  ON public.universe_webhook_deliveries (user_id, created_at DESC);

ALTER TABLE public.universe_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "universe_webhook_deliveries_owner" ON public.universe_webhook_deliveries;
CREATE POLICY "universe_webhook_deliveries_owner"
  ON public.universe_webhook_deliveries FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "universe_webhook_deliveries_service" ON public.universe_webhook_deliveries;
CREATE POLICY "universe_webhook_deliveries_service"
  ON public.universe_webhook_deliveries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Archivio eventi (partitioning logico — move & delete)
CREATE TABLE IF NOT EXISTS public.universe_events_archive (
  id UUID PRIMARY KEY,
  entity_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  processed BOOLEAN DEFAULT true,
  error_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_universe_events_archive_occurred
  ON public.universe_events_archive (occurred_at DESC);

ALTER TABLE public.universe_events_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "universe_events_archive_public_read" ON public.universe_events_archive;
CREATE POLICY "universe_events_archive_public_read"
  ON public.universe_events_archive FOR SELECT USING (true);

DROP POLICY IF EXISTS "universe_events_archive_service" ON public.universe_events_archive;
CREATE POLICY "universe_events_archive_service"
  ON public.universe_events_archive FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION universe_archive_old_events(p_days int DEFAULT 180)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  moved int;
BEGIN
  WITH to_move AS (
    SELECT *
    FROM universe_events
    WHERE occurred_at < now() - make_interval(days => GREATEST(30, p_days))
      AND processed = true
    LIMIT 5000
  ),
  ins AS (
    INSERT INTO universe_events_archive (
      id, entity_id, event_type, payload, occurred_at, processed_at,
      source, processed, error_count, error_message, created_at
    )
    SELECT
      id, entity_id, event_type, payload, occurred_at, processed_at,
      source, processed, error_count, error_message, created_at
    FROM to_move
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  ),
  del AS (
    DELETE FROM universe_events e
    USING to_move t
    WHERE e.id = t.id
    RETURNING 1
  )
  SELECT count(*)::int INTO moved FROM del;
  RETURN COALESCE(moved, 0);
END;
$$;

COMMENT ON FUNCTION universe_archive_old_events IS 'Fase 10 — sposta eventi processati > N giorni in archivio';
