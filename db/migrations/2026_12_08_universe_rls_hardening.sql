-- ============================================================================
-- Universe RLS hardening — restrict observations/events to authenticated users
-- ============================================================================

-- Observations may contain PII (phone, email, raw payloads). Limit reads to
-- authenticated users and service role (backend worker/cron).
DROP POLICY IF EXISTS "universe_observations_public_read" ON public.universe_observations;
CREATE POLICY "universe_observations_public_read"
  ON public.universe_observations FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

-- Events may contain business-sensitive payloads. Same restriction.
DROP POLICY IF EXISTS "universe_events_public_read" ON public.universe_events;
CREATE POLICY "universe_events_public_read"
  ON public.universe_events FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

-- Events archive is append-only audit storage; keep it restricted too.
DROP POLICY IF EXISTS "universe_events_archive_public_read" ON public.universe_events_archive;
CREATE POLICY "universe_events_archive_public_read"
  ON public.universe_events_archive FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

COMMENT ON POLICY "universe_observations_public_read" ON public.universe_observations
  IS 'Read-only per utenti autenticati e service role';
COMMENT ON POLICY "universe_events_public_read" ON public.universe_events
  IS 'Read-only per utenti autenticati e service role';
