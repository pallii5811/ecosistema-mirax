-- MIRAX Universe — Knowledge Graph relations expansion
-- Aggiunge supporto per relazioni commerciali avanzate e nuovi tipi di entita/evento.
-- I campi sono TEXT, quindi nessuna modifica strutturale ai vincoli e' richiesta;
-- questa migration documenta i nuovi valori e ottimizza gli indici.

-- ============================================================
-- 1. NUOVI TIPI DI ENTITA' supportati
-- ============================================================
-- company, person, website, technology, job, event, document, product, location (pre-esistenti)
-- tender, investor, product_category (nuovi)

COMMENT ON TABLE universe_entities IS
'Nodo del knowledge graph commerciale. Tipi supportati: company, person, website, technology, job, event, document, product, location, tender, investor, product_category';

-- ============================================================
-- 2. NUOVI TIPI DI RELAZIONE
-- ============================================================
-- Pre-esistenti: owns, uses, hires, has, receives, buys, competes_with, located_in, related_to, mentioned_in
-- Nuovi: supplies, supplied_by, sells_to, buys_from, partner_of, invested_in,
--        received_investment_from, customer_of, has_customer, awarded_to, awarded_by, competed_for

COMMENT ON TABLE universe_relationships IS
'Archi del knowledge graph. Tipi: owns, uses, hires, has, receives, buys, competes_with, located_in, related_to, mentioned_in, supplies, supplied_by, sells_to, buys_from, partner_of, invested_in, received_investment_from, customer_of, has_customer, awarded_to, awarded_by, competed_for';

-- Indici aggiuntivi per query su grafo avanzate
CREATE INDEX IF NOT EXISTS idx_relationships_source_target ON universe_relationships(source_entity_id, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type_observed ON universe_relationships(relationship_type, observed_at DESC);

-- ============================================================
-- 3. NUOVI TIPI DI EVENTO
-- ============================================================
-- Pre-esistenti: website_changed, pixel_installed, pixel_removed, new_hiring, new_director,
--                crm_installed, ads_started, tender_won, funding_received, registry_change,
--                sector_investment, revenue_changed, employees_changed
-- Nuovi: supplier_sought, expansion_started, new_product_launched, market_entered

COMMENT ON TABLE universe_events IS
'Stream append-only di eventi business. Tipi: website_changed, pixel_installed, pixel_removed, new_hiring, new_director, crm_installed, ads_started, tender_won, funding_received, registry_change, sector_investment, revenue_changed, employees_changed, supplier_sought, expansion_started, new_product_launched, market_entered';

-- Indice per ricerche recenti per tipo di evento
CREATE INDEX IF NOT EXISTS idx_universe_events_type_time ON universe_events(event_type, occurred_at DESC);
