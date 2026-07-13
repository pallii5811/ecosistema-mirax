-- ============================================================================
-- Universe event consumer idempotency
-- ============================================================================

-- lead_alerts did not store the originating event id. Add it so we can enforce
-- uniqueness at the DB level and make the consumer idempotent.
-- Guarded because lead_alerts may not exist in all environments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lead_alerts'
  ) THEN
    ALTER TABLE public.lead_alerts
      ADD COLUMN IF NOT EXISTS event_id uuid;

    -- Prevent duplicate alerts for the same user + event + alert_type.
    -- Partial index excludes rows where event_id is null (legacy alerts).
    CREATE UNIQUE INDEX IF NOT EXISTS lead_alerts_user_event_type_uidx
      ON public.lead_alerts (user_id, event_id, alert_type)
      WHERE event_id IS NOT NULL;
  END IF;
END $$;
