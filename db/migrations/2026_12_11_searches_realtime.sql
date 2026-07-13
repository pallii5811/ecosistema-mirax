-- Fase 12 — Realtime status per le ricerche lead
-- Espone la tabella searches su Supabase Realtime così il frontend può
-- ricevere aggiornamenti status/results senza polling continuo.

ALTER TABLE public.searches REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'searches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.searches;
  END IF;
END $$;
