-- Fase 11 (incrementale) — Durable website snapshots for diff engine
-- Migra la tabella esistente (lead_website/html_hash/text_sample) allo schema
-- richiesto dal worker (url_hash/url/snapshot_text), mantenendo i dati storici.

-- Assicura che le colonne del nuovo schema esistano.
ALTER TABLE website_snapshots ADD COLUMN IF NOT EXISTS url_hash TEXT;
ALTER TABLE website_snapshots ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE website_snapshots ADD COLUMN IF NOT EXISTS snapshot_text TEXT;
ALTER TABLE website_snapshots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill i dati esistenti dove possibile (gli snapshot storici senza url_hash
-- verranno ignorati dal diff engine ma rimangono disponibili per audit).
UPDATE website_snapshots
SET
  url = COALESCE(url, lead_website),
  snapshot_text = COALESCE(snapshot_text, text_sample),
  updated_at = COALESCE(updated_at, captured_at, now())
WHERE url IS NULL OR snapshot_text IS NULL;

-- url_hash deve essere univoco per l'upsert del worker.
CREATE UNIQUE INDEX IF NOT EXISTS idx_website_snapshots_url_hash
  ON website_snapshots (url_hash);

CREATE INDEX IF NOT EXISTS idx_website_snapshots_url
  ON website_snapshots (url);

-- Trigger per aggiornare updated_at automaticamente.
CREATE OR REPLACE FUNCTION update_website_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_website_snapshots_updated_at ON website_snapshots;
CREATE TRIGGER trg_website_snapshots_updated_at
  BEFORE UPDATE ON website_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_website_snapshots_updated_at();

-- Permetti al service role di scrivere; utenti autenticati possono leggere.
ALTER TABLE website_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access website_snapshots" ON website_snapshots;
CREATE POLICY "Service role full access website_snapshots"
  ON website_snapshots FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "website_snapshots public read" ON website_snapshots;
CREATE POLICY "website_snapshots public read"
  ON website_snapshots FOR SELECT
  USING (true);
