-- Fase 9 Universe — Query cache + indici scalabilità

CREATE TABLE IF NOT EXISTS public.universe_query_cache (
  cache_key TEXT PRIMARY KEY,
  cache_kind TEXT NOT NULL DEFAULT 'query',
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_universe_query_cache_expires
  ON public.universe_query_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_universe_query_cache_kind
  ON public.universe_query_cache (cache_kind, expires_at DESC);

ALTER TABLE public.universe_query_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "universe_query_cache_service" ON public.universe_query_cache;
CREATE POLICY "universe_query_cache_service"
  ON public.universe_query_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.universe_query_cache IS 'Fase 9 — cache read-only query/analytics grafo (TTL)';

-- Purge cache scaduta (cron)
CREATE OR REPLACE FUNCTION universe_purge_query_cache()
RETURNS int
LANGUAGE sql
AS $$
  WITH deleted AS (
    DELETE FROM universe_query_cache WHERE expires_at < now() RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;

-- Indice composite per listing entità per last_seen (explorer paginato)
CREATE INDEX IF NOT EXISTS idx_universe_entities_type_last_seen
  ON public.universe_entities (entity_type, last_seen_at DESC NULLS LAST)
  WHERE merged_into_id IS NULL;
