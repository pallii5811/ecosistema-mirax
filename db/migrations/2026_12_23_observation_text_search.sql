-- MIRAX Universe — support text search on jsonb observation values.
-- The generic `value` column is jsonb, so native PostgREST `ilike` fails.
-- This RPC exposes a safe server-side cast.

CREATE OR REPLACE FUNCTION public.universe_observation_text_search(
  p_attribute text,
  p_pattern text
)
RETURNS TABLE(entity_id uuid)
LANGUAGE sql
STABLE
AS $$
  SELECT o.entity_id
  FROM public.universe_observations o
  WHERE o.attribute = p_attribute
    AND o.value::text ILIKE p_pattern;
$$;
