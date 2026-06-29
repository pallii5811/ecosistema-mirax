-- MIRAX Universe Data Model — Phase 1
-- Crea il nuovo modello entità-relazione-evento-osservazione.
-- Sidecar al modello legacy: nessuna tabella esistente viene modificata.

-- ============================================================
-- 1. ENUMS (implementati come CHECK per semplicità di rollback)
-- ============================================================

-- ============================================================
-- 2. ENTITIES
-- ============================================================
CREATE TABLE universe_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT,
    country TEXT DEFAULT 'IT',
    city TEXT,
    region TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    merged_into_id UUID REFERENCES universe_entities(id) ON DELETE SET NULL,
    confidence NUMERIC DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    first_seen_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (canonical_id, entity_type)
);

CREATE INDEX idx_universe_entities_type_city ON universe_entities(entity_type, city);
CREATE INDEX idx_universe_entities_country ON universe_entities(country);
CREATE INDEX idx_universe_entities_name ON universe_entities USING gin(to_tsvector('simple', name));
CREATE INDEX idx_universe_entities_merged ON universe_entities(merged_into_id) WHERE merged_into_id IS NOT NULL;

COMMENT ON TABLE universe_entities IS 'Nodo del knowledge graph commerciale';
COMMENT ON COLUMN universe_entities.canonical_id IS 'Identificatore stabile e normalizzato per deduplicazione';

-- ============================================================
-- 3. ENTITY ALIASES
-- ============================================================
CREATE TABLE universe_entity_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE,
    alias_type TEXT NOT NULL,
    alias_value TEXT NOT NULL,
    confidence NUMERIC DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (entity_id, alias_type, alias_value)
);

CREATE INDEX idx_universe_aliases_value ON universe_entity_aliases(alias_type, alias_value);
CREATE INDEX idx_universe_aliases_entity ON universe_entity_aliases(entity_id);

-- ============================================================
-- 4. OBSERVATIONS (temporal facts)
-- ============================================================
CREATE TABLE universe_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE,
    attribute TEXT NOT NULL,
    value JSONB NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    confidence NUMERIC DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_observations_entity_attr_time ON universe_observations(entity_id, attribute, observed_at DESC);
CREATE INDEX idx_observations_entity_time ON universe_observations(entity_id, observed_at DESC);
CREATE INDEX idx_observations_source ON universe_observations(source, observed_at DESC);
CREATE INDEX idx_observations_attribute_value ON universe_observations(attribute, value) WHERE attribute IN ('meta_pixel', 'google_tag_manager', 'ssl', 'city', 'category');

COMMENT ON TABLE universe_observations IS 'Storia temporale degli attributi delle entità';

-- ============================================================
-- 5. RELATIONSHIPS (graph edges)
-- ============================================================
CREATE TABLE universe_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE,
    target_entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    confidence NUMERIC DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    observed_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source_entity_id, target_entity_id, relationship_type)
);

CREATE INDEX idx_relationships_source_type ON universe_relationships(source_entity_id, relationship_type);
CREATE INDEX idx_relationships_target_type ON universe_relationships(target_entity_id, relationship_type);
CREATE INDEX idx_relationships_type ON universe_relationships(relationship_type);

COMMENT ON TABLE universe_relationships IS 'Archi del knowledge graph';

-- ============================================================
-- 6. EVENTS (append-only event stream)
-- ============================================================
CREATE TABLE universe_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID REFERENCES universe_entities(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ,
    source TEXT NOT NULL,
    processed BOOLEAN DEFAULT false,
    error_count INTEGER DEFAULT 0 CHECK (error_count >= 0),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_universe_events_entity_type_time ON universe_events(entity_id, event_type, occurred_at DESC);
CREATE INDEX idx_universe_events_unprocessed ON universe_events(processed, error_count) WHERE processed = false;
CREATE INDEX idx_universe_events_occurred ON universe_events(occurred_at DESC);

COMMENT ON TABLE universe_events IS 'Stream append-only di eventi business';

-- ============================================================
-- 7. USER CONTEXT (private user-entity relationships)
-- ============================================================
CREATE TABLE universe_user_context (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE,
    context_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, entity_id, context_type)
);

CREATE INDEX idx_universe_user_context_user ON universe_user_context(user_id, context_type);
CREATE INDEX idx_universe_user_context_entity ON universe_user_context(entity_id);

COMMENT ON TABLE universe_user_context IS 'Contesto privato utente sulle entità pubbliche';

-- ============================================================
-- 8. UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION universe_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_universe_entities_updated_at
    BEFORE UPDATE ON universe_entities
    FOR EACH ROW EXECUTE FUNCTION universe_set_updated_at();

CREATE TRIGGER tr_universe_user_context_updated_at
    BEFORE UPDATE ON universe_user_context
    FOR EACH ROW EXECUTE FUNCTION universe_set_updated_at();

-- ============================================================
-- 9. RLS POLICIES
-- ============================================================
ALTER TABLE universe_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_user_context ENABLE ROW LEVEL SECURITY;

-- Public read-only for global data
DROP POLICY IF EXISTS "universe_entities_public_read" ON universe_entities;
CREATE POLICY "universe_entities_public_read"
    ON universe_entities FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "universe_aliases_public_read" ON universe_entity_aliases;
CREATE POLICY "universe_aliases_public_read"
    ON universe_entity_aliases FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "universe_observations_public_read" ON universe_observations;
CREATE POLICY "universe_observations_public_read"
    ON universe_observations FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "universe_relationships_public_read" ON universe_relationships;
CREATE POLICY "universe_relationships_public_read"
    ON universe_relationships FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "universe_events_public_read" ON universe_events;
CREATE POLICY "universe_events_public_read"
    ON universe_events FOR SELECT
    USING (true);

-- Write only via service role
DROP POLICY IF EXISTS "universe_entities_service_write" ON universe_entities;
CREATE POLICY "universe_entities_service_write"
    ON universe_entities FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "universe_aliases_service_write" ON universe_entity_aliases;
CREATE POLICY "universe_aliases_service_write"
    ON universe_entity_aliases FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "universe_observations_service_write" ON universe_observations;
CREATE POLICY "universe_observations_service_write"
    ON universe_observations FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "universe_relationships_service_write" ON universe_relationships;
CREATE POLICY "universe_relationships_service_write"
    ON universe_relationships FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "universe_events_service_write" ON universe_events;
CREATE POLICY "universe_events_service_write"
    ON universe_events FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- User context is private
DROP POLICY IF EXISTS "universe_user_context_owner" ON universe_user_context;
CREATE POLICY "universe_user_context_owner"
    ON universe_user_context FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 10. HELPER FUNCTIONS
-- ============================================================

-- Restituisce l'ultima osservazione per attributo
CREATE OR REPLACE FUNCTION universe_latest_observation(
    p_entity_id UUID,
    p_attribute TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_value JSONB;
BEGIN
    SELECT value INTO v_value
    FROM universe_observations
    WHERE entity_id = p_entity_id AND attribute = p_attribute
    ORDER BY observed_at DESC, created_at DESC
    LIMIT 1;
    RETURN v_value;
END;
$$ LANGUAGE plpgsql STABLE;

-- Restituisce tutte le entità correlate
CREATE OR REPLACE FUNCTION universe_related_entities(
    p_entity_id UUID,
    p_relationship_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    relationship_id UUID,
    related_entity_id UUID,
    related_entity_type TEXT,
    related_entity_name TEXT,
    relationship_type TEXT,
    confidence NUMERIC,
    observed_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id AS relationship_id,
        r.target_entity_id AS related_entity_id,
        e.entity_type AS related_entity_type,
        e.name AS related_entity_name,
        r.relationship_type,
        r.confidence,
        r.observed_at
    FROM universe_relationships r
    JOIN universe_entities e ON e.id = r.target_entity_id
    WHERE r.source_entity_id = p_entity_id
      AND (p_relationship_type IS NULL OR r.relationship_type = p_relationship_type)
    ORDER BY r.observed_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Backfill helper: cerca entità per alias (usato in fase di ingest)
CREATE OR REPLACE FUNCTION universe_resolve_entity_by_alias(
    p_alias_type TEXT,
    p_alias_value TEXT,
    p_entity_type TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_entity_id UUID;
BEGIN
    SELECT a.entity_id INTO v_entity_id
    FROM universe_entity_aliases a
    JOIN universe_entities e ON e.id = a.entity_id
    WHERE a.alias_type = p_alias_type
      AND a.alias_value = p_alias_value
      AND (p_entity_type IS NULL OR e.entity_type = p_entity_type)
      AND e.merged_into_id IS NULL
    ORDER BY a.confidence DESC, a.created_at DESC
    LIMIT 1;

    -- Se l'entità trovata è stata mergiata, segui la catena
    IF v_entity_id IS NOT NULL THEN
        SELECT COALESCE(m.merged_into_id, v_entity_id) INTO v_entity_id
        FROM universe_entities m
        WHERE m.id = v_entity_id;
    END IF;

    RETURN v_entity_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 11. REALTIME (opzionale, abilitato su universe_user_context)
-- ============================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE universe_user_context;
-- ALTER PUBLICATION supabase_realtime ADD TABLE universe_events;

-- ============================================================
-- 12. COMMENTI
-- ============================================================
COMMENT ON TABLE universe_entities IS 'Knowledge graph nodes';
COMMENT ON TABLE universe_observations IS 'Temporal attribute history';
COMMENT ON TABLE universe_relationships IS 'Knowledge graph edges';
COMMENT ON TABLE universe_events IS 'Append-only business event stream';
COMMENT ON TABLE universe_user_context IS 'Private user context on public entities';
