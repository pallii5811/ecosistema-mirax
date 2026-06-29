-- Fase 8 Universe — Realtime events + analytics RPC + indici scalabilità

-- Realtime publication (idempotente)
ALTER TABLE public.universe_events REPLICA IDENTITY FULL;
ALTER TABLE public.universe_user_context REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'universe_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.universe_events;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'universe_user_context'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.universe_user_context;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_universe_events_type_occurred
  ON public.universe_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_universe_events_unprocessed_time
  ON public.universe_events (occurred_at DESC)
  WHERE processed = false;

-- Analytics aggregate (single round-trip per dashboard)
CREATE OR REPLACE FUNCTION universe_analytics_summary(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'companies', (
      SELECT count(*)::int FROM universe_entities
      WHERE entity_type = 'company' AND merged_into_id IS NULL
    ),
    'observations', (SELECT count(*)::int FROM universe_observations),
    'relationships', (SELECT count(*)::int FROM universe_relationships),
    'events_total', (SELECT count(*)::int FROM universe_events),
    'events_unprocessed', (
      SELECT count(*)::int FROM universe_events WHERE processed = false
    ),
    'events_last_7d', (
      SELECT count(*)::int FROM universe_events
      WHERE occurred_at >= now() - interval '7 days'
    ),
    'events_by_type', COALESCE((
      SELECT jsonb_object_agg(event_type, cnt)
      FROM (
        SELECT event_type, count(*)::int AS cnt
        FROM universe_events
        WHERE occurred_at >= now() - make_interval(days => GREATEST(1, p_days))
        GROUP BY event_type
        ORDER BY cnt DESC
        LIMIT 20
      ) t
    ), '{}'::jsonb),
    'top_cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', city, 'count', cnt))
      FROM (
        SELECT city, count(*)::int AS cnt
        FROM universe_entities
        WHERE entity_type = 'company'
          AND merged_into_id IS NULL
          AND city IS NOT NULL
          AND btrim(city) <> ''
        GROUP BY city
        ORDER BY cnt DESC
        LIMIT 10
      ) c
    ), '[]'::jsonb),
    'observations_by_source', COALESCE((
      SELECT jsonb_object_agg(source, cnt)
      FROM (
        SELECT source, count(*)::int AS cnt
        FROM universe_observations
        WHERE observed_at >= now() - make_interval(days => GREATEST(1, p_days))
        GROUP BY source
        ORDER BY cnt DESC
        LIMIT 15
      ) s
    ), '{}'::jsonb),
    'generated_at', to_jsonb(now())
  );
$$;

COMMENT ON FUNCTION universe_analytics_summary IS 'Fase 8 — metriche aggregate Knowledge Graph';
