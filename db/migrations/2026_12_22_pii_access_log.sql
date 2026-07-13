-- Fase 6/7 — PII Access Log.
-- Tracks every explicit access to sensitive contacts (phone, email, PEC, mobile)
-- so MIRAX stays compliant and the user has an audit trail.

CREATE TABLE IF NOT EXISTS public.universe_pii_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES public.universe_entities(id) ON DELETE CASCADE,
  access_type TEXT NOT NULL CHECK (access_type IN ('phone', 'email', 'pec_email', 'mobile_phone', 'all')),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'dashboard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.universe_pii_access_log IS
  'Audit trail for explicit access to PII contacts from the knowledge graph.';

CREATE INDEX IF NOT EXISTS idx_universe_pii_access_user_time
  ON public.universe_pii_access_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_universe_pii_access_entity
  ON public.universe_pii_access_log (entity_id, created_at DESC);

ALTER TABLE public.universe_pii_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "universe_pii_access_owner" ON public.universe_pii_access_log;
CREATE POLICY "universe_pii_access_owner"
  ON public.universe_pii_access_log FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "universe_pii_access_owner_insert" ON public.universe_pii_access_log;
CREATE POLICY "universe_pii_access_owner_insert"
  ON public.universe_pii_access_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "universe_pii_access_service" ON public.universe_pii_access_log;
CREATE POLICY "universe_pii_access_service"
  ON public.universe_pii_access_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
