-- Fase 11 (incrementale) — Idempotenza relationship graph
-- Aggiunge chiave di deduplicazione giornaliera alle relazioni,
-- in modo che re-ingest nello stesso giorno aggiorni confidence/metadata
-- invece di creare duplicati.

ALTER TABLE universe_relationships ADD COLUMN IF NOT EXISTS dedup_key TEXT;

UPDATE universe_relationships
SET dedup_key = source_entity_id || ':' || target_entity_id || ':' || relationship_type || ':' || date_trunc('day', observed_at)::text
WHERE dedup_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_universe_relationships_dedup
  ON universe_relationships (dedup_key);

ALTER TABLE universe_relationships ALTER COLUMN dedup_key SET NOT NULL;
