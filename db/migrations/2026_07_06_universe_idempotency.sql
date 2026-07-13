-- Fase 11 (incrementale) — Idempotenza ingest + consumer
-- Aggiunge chiavi di deduplicazione deterministiche a observations/events
-- e vincolo unico su lead_alerts per prevenire alert doppi.

-- Observations
ALTER TABLE universe_observations ADD COLUMN IF NOT EXISTS dedup_key TEXT;

UPDATE universe_observations
SET dedup_key = entity_id || ':' || attribute || ':' || source || ':' || date_trunc('day', observed_at)::text
WHERE dedup_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_universe_observations_dedup
  ON universe_observations (dedup_key);

ALTER TABLE universe_observations ALTER COLUMN dedup_key SET NOT NULL;

-- Events
ALTER TABLE universe_events ADD COLUMN IF NOT EXISTS dedup_key TEXT;

UPDATE universe_events
SET dedup_key = COALESCE(entity_id::text, 'none') || ':' || event_type || ':' || source || ':' || date_trunc('day', occurred_at)::text || ':' || md5(payload::text)
WHERE dedup_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_universe_events_dedup
  ON universe_events (dedup_key);

ALTER TABLE universe_events ALTER COLUMN dedup_key SET NOT NULL;

-- Prevent duplicate lead_alerts from concurrent/repeated event processing.
-- Guarded because lead_alerts may not exist in all environments (e.g. partial dev dumps).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lead_alerts'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_alerts_unique_event
      ON lead_alerts (user_id, event_id, alert_type)
      WHERE event_id IS NOT NULL;
  END IF;
END $$;

-- Support mandatory webhook secret for user_integrations (Universe outbound webhooks).
-- Guarded because user_integrations may not exist in all environments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_integrations'
  ) THEN
    ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
  END IF;
END $$;
