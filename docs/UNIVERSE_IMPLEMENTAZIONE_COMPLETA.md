# MIRAX Universe Knowledge Graph — Documentazione tecnica completa

**Repo:** `WEB APP CKB - Dev` → GitHub `pallii5811/ecosistema-mirax`  
**Staging:** Vercel `ecosistema-mirax.vercel.app` · Supabase dev `ktspchugdwpqvxhmysap` · Worker Hetzner `116.203.137.39:8002`  
**Produzione legacy (NON toccare):** `WEB APP CKB - Copia` → miraxgroup.it  

**Documenti correlati:** `docs/UNIVERSE_DATA_MODEL.md`, `docs/CURSOR_IMPLEMENTATION_BRIEF_MIRAX_V1.md`  
**Ultimo aggiornamento:** 2026-06-29 · Fasi 0–10 implementate in codice · deploy/migration operativi parziali  

---

## 1. Visione architetturale

### 1.1 Problema che risolve

MIRAX legacy memorizza i lead come **JSONB blob** in `searches.results`: dati piatti, duplicati, nessuna storia temporale, nessun grafo relazionale. La direzione **Universe** introduce un **Commercial Knowledge Graph** parallelo:

| Concetto | Implementazione |
|----------|-----------------|
| **Entità** | Azienda, persona, sito, tecnologia, job, evento, documento… |
| **Osservazioni** | Fatti temporali versionati (`meta_pixel=true` il 2026-03-01 da `audit`) |
| **Relazioni** | Archi tipizzati (`company` → `hires` → `job`) |
| **Eventi** | Stream append-only (`website_changed`, `new_hiring`, …) |
| **Contesto utente** | Layer privato per utente (`saved`, `pipeline`, `note`, …) |

### 1.2 Pattern sidecar (invariante critico)

```
┌─────────────────────────────────────────────────────────────────┐
│  LEGACY (immutato come source of truth per Maps scrape)         │
│  searches.results JSONB · lead_pipeline · crediti · cache Maps   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ dual-write (async, gated)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  UNIVERSE (sidecar opzionale)                                    │
│  universe_entities · observations · relationships · events       │
└───────────────────────────────┬─────────────────────────────────┘
                                │ read-back (gated)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  HYDRATE → arricchisce JSONB lead con dati grafo più freschi   │
│  AGENTIC SEARCH → interroga grafo senza consumare crediti Maps │
└─────────────────────────────────────────────────────────────────┘
```

**Regole non negoziabili:**
1. `UNIVERSE_ENABLED=0` (default) → zero scritture grafo, zero impatto legacy.
2. Errori ingest Universe **non devono mai** far fallire scrape/enrich/pipeline.
3. Ingest **idempotente**: stesso lead + stessa osservazione non duplica righe (upsert su `canonical_id`, unique su relazioni).
4. PII: email/telefono come **alias** o in `universe_user_context`, non in entità pubbliche.

### 1.3 Attribuzione implementazione

| Fase | Autore | Deliverable principale |
|------|--------|------------------------|
| **0** | Kimi | Piano + `docs/UNIVERSE_DATA_MODEL.md` |
| **1** | Kimi | Migration `2026_07_02_universe_entities.sql` (6 tabelle core) |
| **2** | Kimi | SDK TS repositories + mirror Python `backend_mirror/universe/` |
| **3** | Kimi | `ingest-lead.ts`, `sidecar.ts`, hook worker/enrich/pipeline/cron |
| **4** | Kimi + Cursor | API read `/api/universe/*`, `query-builder.ts`, auth |
| **5** | Cursor | Agentic Search UI completa, URL `?q=`, CSV, stats, mobile |
| **6** | Cursor | Hydrate read-sidecar, badge ResultsTable, stats API |
| **7** | Cursor | Digital Twin, user context, Universe Agent multi-agent |
| **8** | Cursor | Realtime events, analytics RPC, live feed, cron consumer |
| **9** | Cursor | Query cache DB, alerting → `lead_alerts`, purge |
| **10** | Cursor | Graph ranking, webhook outbound, archivio eventi |

**Altri contributi correlati (non Universe ma abilitanti):**
- **Kimi / sessioni precedenti:** MIRAX Semantic Engine (`parse-semantic.ts`), Signal Intent ibrido heuristic+LLM, `lead_business_signals`, enrichment worker.
- **Cursor (altre sessioni):** liste/ambienti, outreach multi-canale, landing redesign — fuori scope Universe ma coesistono nello stesso repo Dev.

---

## 2. Schema database (4 migration)

Applicate via `npm run db:apply-mirax` nell'ordine in `scripts/apply-mirax-migrations.mjs`.

### 2.1 `2026_07_02_universe_entities.sql` — Core (Fase 1)

#### `universe_entities`
Nodo del grafo. Chiave di deduplicazione: `(canonical_id, entity_type)` UNIQUE.

| Colonna | Tipo | Ruolo tecnico |
|---------|------|---------------|
| `canonical_id` | TEXT | ID stabile normalizzato (es. dominio `acme.it`, slug tech `gtm`) |
| `entity_type` | TEXT | `company`, `person`, `website`, `technology`, `job`, `event`, `document`, `product`, `location` |
| `name` | TEXT | Display name |
| `city`, `country`, `region` | TEXT | Geografia per filtri Agentic |
| `metadata` | JSONB | Campi extra non osservati temporalmente |
| `merged_into_id` | UUID FK | Deduplicazione: entità fuse puntano al master |
| `confidence` | NUMERIC 0–1 | Affidabilità entità |
| `first_seen_at`, `last_seen_at` | TIMESTAMPTZ | Freschezza (usata da Graph Rank Fase 10) |

**Indici:** `(entity_type, city)`, GIN su `name` full-text, `merged_into_id` parziale.

#### `universe_entity_aliases`
Risoluzione cross-fonte: stesso ente raggiungibile via dominio, P.IVA, telefono, email, LinkedIn, varianti nome.

```sql
UNIQUE (entity_id, alias_type, alias_value)
INDEX (alias_type, alias_value)  -- lookup O(1) per resolve
```

`alias_type`: `domain`, `vat`, `linkedin`, `phone`, `email`, `name_variant`.

#### `universe_observations`
**Cuore temporale.** Ogni cambiamento attributo = nuova riga (mai UPDATE in-place del valore storico).

| Colonna | Ruolo |
|---------|-------|
| `attribute` | Nome logico: `meta_pixel`, `rating`, `employees`, `revenue`, … |
| `value` | JSONB (boolean, number, string, object) |
| `observed_at` | Timestamp del fatto |
| `source` | Provenienza: `maps_scrape`, `audit`, `clay_enrichment`, `reaudit`, … |
| `confidence` | Peso osservazione |

**Indice critico:** `(entity_id, attribute, observed_at DESC)` → `universe_latest_observation()` in O(1) per attributo.

#### `universe_relationships`
Archi diretti tra entità.

```sql
UNIQUE (source_entity_id, target_entity_id, relationship_type)
```

Tipi: `owns`, `uses`, `hires`, `has`, `receives`, `buys`, `competes_with`, `located_in`, `related_to`, `mentioned_in`.

Esempio hiring: `company(Acme)` —`hires`→ `job(developer_milano)`.

#### `universe_events`
Stream append-only per automazioni downstream.

| Colonna | Ruolo |
|---------|-------|
| `event_type` | `website_changed`, `new_hiring`, `crm_installed`, … |
| `payload` | JSONB contesto (summary, URL, ruolo, …) |
| `processed` | FALSE finché cron consumer non elabora |
| `error_count` | Retry tracking |

#### `universe_user_context`
**Privato per utente** (RLS `auth.uid() = user_id`).

`context_type`: `saved`, `contacted`, `pipeline`, `ignored`, `note`, `hidden`.

#### Funzioni SQL helper
| Funzione | Input | Output |
|----------|-------|--------|
| `universe_latest_observation(p_entity_id, p_attribute)` | UUID, TEXT | Ultimo valore JSONB |
| `universe_related_entities(p_entity_id, p_rel_type, p_direction, p_depth)` | UUID, TEXT, TEXT, INT | Subgrafo |
| `universe_resolve_entity_by_alias(p_alias_type, p_alias_value)` | TEXT, TEXT | UUID entità |

#### RLS (sicurezza)
- **Lettura pubblica:** entities, observations, relationships, events (dati business aggregati).
- **Scrittura:** solo `service_role` (ingest sidecar).
- **user_context:** owner-only read/write.

---

### 2.2 `2026_07_03_universe_realtime_analytics.sql` — Fase 8

- `ALTER PUBLICATION supabase_realtime ADD TABLE universe_events, universe_user_context`
- Indici aggiuntivi su `universe_events(occurred_at DESC)`
- **RPC `universe_analytics_summary(p_days INT)`** → JSON con:
  - `companies`, `observations`, `relationships`, `events_total`
  - `events_last_7d`, `events_unprocessed`
  - `events_by_type`, `observations_by_source`, `top_cities[]`

---

### 2.3 `2026_07_04_universe_scale.sql` — Fase 9

#### `universe_query_cache`
Cache persistente per query costose (Agentic Search, analytics).

```sql
cache_key TEXT PRIMARY KEY   -- es. "agentic:<sha256-32>"
kind TEXT                    -- 'agentic' | 'analytics'
payload JSONB                -- risultato serializzato
expires_at TIMESTAMPTZ
```

**RPC `universe_purge_query_cache()`** — elimina righe scadute (chiamata dal cron consumer).

**Indice:** `idx_universe_entities_type_last_seen` per query freschezza.

---

### 2.4 `2026_07_05_universe_webhooks_ranking.sql` — Fase 10

#### `universe_webhook_deliveries`
Audit log consegne webhook outbound.

```sql
status IN ('success', 'error')
payload JSONB  -- envelope inviato
```

RLS: utente vede solo le proprie consegne; service_role scrive.

#### `universe_events_archive`
Partitioning **logico** (non fisico PostgreSQL): eventi vecchi spostati qui prima del DELETE.

#### `universe_archive_old_events(p_days INT DEFAULT 180)`
1. SELECT eventi `processed=true` e `occurred_at < now() - p_days` (max 5000)
2. INSERT in archive ON CONFLICT DO NOTHING
3. DELETE da `universe_events`
4. RETURN count spostati

---

## 3. SDK TypeScript (`src/lib/universe/`)

### 3.1 Layer fondazione (Kimi — Fase 2)

| Modulo | Responsabilità tecnica |
|--------|------------------------|
| `types.ts` | Tipi strict: `UniverseEntity`, `UniverseObservation`, `UniverseEvent`, `UniverseQuery`, … |
| `canonical.ts` | `normalizeDomain()`, `normalizePhone()`, `normalizeEmail()`, `normalizeVat()`, slug tech/location |
| `errors.ts` | `UniverseError`, `wrapSupabaseError()` |
| `entity-repository.ts` | `upsertEntity`, `getEntityById`, `getEntityByCanonicalId`, `listEntities`, merge |
| `observation-repository.ts` | `createObservations`, `getLatestObservation`, `getTimeline` |
| `relationship-repository.ts` | `createRelationships`, `getRelatedEntities` |
| `event-repository.ts` | `appendEvent(s)`, `getEvents`, `markEventProcessed` |

### 3.2 Ingest (Kimi — Fase 3)

#### `ingest-lead.ts`
Pipeline completa `MiraxLeadInput` → grafo:

```
1. Risolvi/crea company entity (canonical_id = dominio normalizzato)
2. Crea alias (domain, phone, email, vat, linkedin)
3. Emetti observations per ogni attributo audit/maps/openapi
4. Crea entità satellite (website, technology meta_pixel/gtm, job da hiring)
5. Crea relationships (uses, hires, owns, located_in)
6. appendEvents per delta rilevanti (pixel_installed, website_changed, …)
```

**Idempotenza:** upsert entity; observations con stesso `(entity, attribute, observed_at, value)` dedupe a livello applicativo; relationships UNIQUE.

#### `ingest-clay.ts`
Path parallelo per `ClayEnrichedLead` post-enrichment OpenAPI/social.

#### `sidecar.ts`
```typescript
isUniverseEnabled() → process.env.UNIVERSE_ENABLED === '1'
ingestMiraxLeadSidecarAsync(sb, lead, source, userId)  // fire-and-forget
```
Mai await bloccante nelle API user-facing.

### 3.3 Query engine (Kimi Fase 4 + Cursor Fase 5)

#### `query-builder.ts`
`UniverseQuery` strutturato:

```typescript
{
  entity_type: 'company',
  filters: {
    city?: string,
    name_contains?: string,
    observations?: [{ attribute, operator, value }]  // eq, gte, is_null, …
  },
  relationships?: [{
    relationship_type: 'hires',
    direction: 'outgoing',
    target_entity_type: 'job',
    target_filters?: { name_contains: 'developer' }
  }],
  limit: 50
}
```

`executeUniverseQuery(sb, query)` → `{ entities, total }` via join observations + relationships.

#### `agentic-search.ts` (Fase 5)
Bridge Signal Intent → grafo → shape legacy:

```typescript
signalIntentToUniverseQuery(intent: SignalIntentSpec) → UniverseQueryIntent
entityToMiraxLeadRow(sb, entity) → Record compatibile ResultsTable
executeAgenticUniverseSearch(sb, intent, opts) → ranked results
```

**Fase 10:** chiama `rankUniverseEntities()` prima di `entityToMiraxLeadRow`, setta `graph_score` e `_score`.

### 3.4 Read sidecar (Cursor — Fase 6)

#### `hydrate-leads.ts`
```typescript
isUniverseReadEnabled() → UNIVERSE_READ_ENABLED=1 OR UNIVERSE_ENABLED=1
hydrateLeadsFromUniverse(sb, leads[], { max }) → { leads, hydrated_count }
```

Per ogni lead con dominio risolvibile:
1. `getEntityByCanonicalId(domain)`
2. Merge `getLatestObservation` su attributi mancanti nel JSONB
3. Stampa `universe_entity_id`, `universe_hydrated_fields[]`, `universe_source: true`

Integrato in `check-scrape-job/route.ts` — risposta include `universe_hydrated: N`.

### 3.5 Digital Twin (Cursor — Fase 7)

#### `digital-twin.ts`
`buildDigitalTwin(sb, entityId, userId)` aggrega:
- Entity core + `latest_observations` collapsed
- `related` entities (1 hop)
- `events` recenti
- `user_context[]` per utente corrente
- `opportunity_score` euristico (no pixel +30, no sito +30, no instagram +15)

#### `user-context-repository.ts`
CRUD su `universe_user_context` con upsert per `(user_id, entity_id, context_type)`.

### 3.6 Realtime & Analytics (Cursor — Fase 8)

#### `analytics.ts`
Wrapper RPC `universe_analytics_summary`.

#### `analytics-cache.ts`
`getUniverseAnalyticsCached(sb, days)` — legge/scrive `universe_query_cache` con TTL `UNIVERSE_CACHE_TTL_ANALYTICS` (default 120s).

#### `src/lib/realtime/universe-event-stream.ts`
- `subscribeToUniverseEvents(supabase, callback, { entityId })` — channel Supabase Realtime su INSERT `universe_events`
- `prependUniverseEvent`, `formatUniverseEventHeadline`
- Gated da `NEXT_PUBLIC_UNIVERSE_REALTIME !== 'false'`

#### `event-consumer.ts`
`processUniverseEventBatch(sb, limit=50)`:
```
per ogni evento non processed:
  1. dispatchUniverseEventAlerts → lead_alerts
  2. dispatchUniverseEventWebhooks → HTTP POST + audit log
  3. markEventProcessed
post-batch:
  4. purgeExpiredQueryCache()
  5. archiveOldUniverseEvents()
```

### 3.7 Scale & outbound (Cursor — Fasi 9–10)

#### `query-cache.ts`
```typescript
buildUniverseCacheKey(kind, payload) → `${kind}:${sha256(payload).slice(0,32)}`
getQueryCache / setQueryCache / purgeExpiredQueryCache
isUniverseCacheEnabled() → UNIVERSE_CACHE_ENABLED=1 OR UNIVERSE_ENABLED=1
```

Usato in `agentic-search/route.ts` e `analytics/route.ts`.

#### `alerting.ts`
`dispatchUniverseEventAlerts(sb, event)`:
- Trova utenti con `universe_user_context` su `entity_id` dell'evento
- Inserisce in `lead_alerts` con `alert_type = 'universe_graph'`
- Ritorna `{ notified, skipped, user_ids }`

#### `webhooks.ts`
`dispatchUniverseEventWebhooks(sb, event, entity, userIds)`:
1. Risolve URL da `user_integrations.webhook_url` e `crm_integrations` type=`webhook`
2. POST envelope JSON:
```json
{
  "type": "universe.graph.event",
  "version": 1,
  "event_type": "new_hiring",
  "entity_id": "...",
  "canonical_id": "acme.it",
  "payload": { ... }
}
```
3. Header `X-MiraX-Signature: sha256=<hmac>` se secret configurato
4. Log in `universe_webhook_deliveries`

#### `graph-ranking.ts` (Fase 10)
Rule-based score 0–100:

```
base = 35
+ freshness (0–12) da last_seen_at
+ intent_location (0–10) match città
+ intent_category (0–8) match nome/categoria
+ min(20, recent_events_30d * 4)
+ min(12, relationships * 2)
+ min(10, observations / 2)
+ confidence * 5
→ min(100, round)
```

`rankUniverseEntities()` batch-fetch counts per entity_id, sort DESC.

#### `event-archive.ts`
Thin wrapper su RPC `universe_archive_old_events(UNIVERSE_EVENTS_ARCHIVE_DAYS)`.

### 3.8 Client browser (`client.ts`)
Fetch wrapper per tutte le API Universe + `runUniverseAgentPipeline()`.

### 3.9 Auth (`require-auth.ts`)
Tutte le route Universe user-facing: session Supabase obbligatoria, 401 se anonimo.

---

## 4. SDK Python (`backend_mirror/universe/`)

Mirror del ingest TS per il worker Hetzner (nessun Node nel worker).

| File | Ruolo |
|------|-------|
| `canonical.py` | Stesse regole normalizzazione di `canonical.ts` |
| `models.py` | Dataclass `UniverseEntity`, `IngestResult`, … |
| `repository.py` | CRUD Supabase REST via `UniverseRepository` |
| `ingest.py` | `ingest_mirax_lead(repo, lead, source, user_id)` |
| `sidecar.py` | `is_universe_enabled()`, `ingest_leads_batch()` |

**Integrazione worker** (`worker_supabase.py`):
```python
if os.getenv("UNIVERSE_ENABLED", "0") == "1":
    try:
        ingest_leads_batch(formatted_leads, source="maps_scrape", user_id=...)
    except Exception as e:
        print("[universe] ingest failed:", e)  # NON raise
```

Stesso pattern post `enrich_results_business_events`.

---

## 5. API HTTP — reference completa

### 5.1 Read / Search

| Method | Path | Body / Query | Risposta |
|--------|------|--------------|----------|
| POST | `/api/universe/entities/search` | `{ entity_type, city, name_contains, filters }` | `{ entities[], count }` |
| GET | `/api/universe/entities/resolve?domain=` | — | `{ entity, timeline, related }` o 404 |
| GET | `/api/universe/entities/:id` | — | `{ entity, timeline, related, events? }` |
| POST | `/api/universe/entities/:id/related` | `{ depth?, relationship_type? }` | `{ related[] }` |
| GET | `/api/universe/entities/:id/twin` | — | `{ ok, twin: DigitalTwinSnapshot }` |
| GET/POST/DELETE | `/api/universe/entities/:id/context` | `{ context_type, metadata? }` | CRUD user context |
| POST | `/api/universe/query` | `UniverseQuery` | `{ entities, total }` |
| GET | `/api/universe/timeline/:id` | `?attribute=` | `{ points[], count }` |
| POST | `/api/universe/agentic-search` | `{ user_query, city?, limit? }` | Signal intent + results + `elapsed_ms` + `cache_hit` |
| POST | `/api/universe/hydrate-leads` | `{ leads[] }` | `{ leads[], hydrated_count }` |
| GET | `/api/universe/stats` | — | Conteggi leggeri per UI banner |
| GET | `/api/universe/analytics` | `?days=30` | `{ analytics, cache_hit }` |
| GET | `/api/universe/events/recent` | `?limit=&entity_id=` | `{ events[] }` con `entity_name` |
| GET | `/api/universe/alerts` | `?limit=` | `{ alerts[] }` da `lead_alerts` |
| PATCH | `/api/universe/alerts` | `{ alert_id }` | mark read |
| GET | `/api/universe/webhooks/deliveries` | `?limit=` | `{ deliveries[] }` |

### 5.2 Cron (service secret, no user session)

| Path | Schedule | Azione |
|------|----------|--------|
| `/api/cron/universe-process-events` | `0 */2 * * *` | `processUniverseEventBatch(50)` |
| `/api/cron/universe-reconcile` | `30 4 * * 0` | Confronta legacy vs grafo, backfill opzionale |

---

## 6. UI (`src/components/universe/` + pages)

### 6.1 Dashboard `/dashboard/universe`

**Tab Ricerca AI** (`?q=` auto-run):
- `AgenticSearchPanel` — textarea NL, esempi, city override, limit, export CSV
- `AgenticIntentBreakdown` — chips intent parsato
- `AgenticQueryPlan` — piano query trasparente
- `AgenticResultsTable` / `AgenticResultsCards` — responsive, colonna **Graph rank**
- `UniverseGraphStats` — banner conteggi grafo

**Tab Esplora:**
- `UniverseExplorerPanel` — search manuale per tipo/città/nome

**Tab Live & Analytics** (`?tab=analytics`):
- `UniverseAnalyticsPanel` — RPC analytics
- `UniverseAlertsPanel` — alert grafo
- `UniverseWebhookDeliveriesPanel` — audit webhook (Fase 10)
- `UniverseLiveEventsFeed` — polling + Supabase Realtime LIVE badge

**Deep linking:**
- `?q=<query>` → tab agentic, auto-run
- `?tab=explore|analytics` → tab sincronizzato con URL

### 6.2 Entity detail `/dashboard/universe/[id]`
- `UniverseDigitalTwinPanel` — snapshot completo + azioni agent
- `UniverseTimeline`, `UniverseRelationsList`, `UniverseEventsList`

### 6.3 Integrazioni UI legacy
| Componente | Dove | Cosa fa |
|------------|------|---------|
| `UniverseHydratedBadge` | `ResultsTable.tsx` | Link a entità grafo se lead idratato |
| `UniverseLeadPanel` | `LeadDetailClient.tsx` | Preview grafo da dominio lead |
| CTA Knowledge Graph | `DashboardShell.tsx` | Link `/dashboard/universe?q={query}` se `SHOW_UNIVERSE_UI` |

---

## 7. Multi-agent system (Fase 7)

### `src/lib/agents/universe-agent.ts`
Azioni:
- `twin` — buildDigitalTwin
- `agentic_search` — executeAgenticUniverseSearch
- `resolve_domain` — getEntityByCanonicalId + timeline

Registrato in `registry.ts` come agent `universe`, pipeline `graph_intel`, `graph_pitch`.  
Invocabile via `POST /api/agents/run` con `{ pipeline: ['universe'], input: { action, ... } }`.

---

## 8. Integrazioni write-path (dual-write)

| Punto | File | Trigger | Source tag |
|-------|------|---------|------------|
| Maps scrape | `worker_supabase.py` | Fine job audit | `maps_scrape` |
| Post external enrich | `worker_supabase.py` | Dopo business events | `maps_scrape` |
| Clay enrich | `enrich-lead/route.ts` | Async post-response | `clay_enrichment` |
| Pipeline CRM | `pipeline/route.ts` | Move stage | `universe_user_context.pipeline` |
| Re-audit | `cron/reaudit/route.ts` | Website diff | `reaudit` + event `website_changed` |
| Business events API | `lead/business-events/route.ts` | User trigger | `business_events_api` |
| Website change cron | `cron/website-change-detect/route.ts` | Scheduled diff | event `website_changed` |

---

## 9. Variabili d'ambiente

```env
# Write ingest (worker, enrich, reaudit, pipeline side effects)
UNIVERSE_ENABLED=0

# Read hydrate su check-scrape-job (auto true se UNIVERSE_ENABLED=1)
UNIVERSE_READ_ENABLED=0

# UI
NEXT_PUBLIC_UNIVERSE_UI=true          # false = nasconde sidebar + CTA
NEXT_PUBLIC_UNIVERSE_REALTIME=true    # false = no websocket live feed

# Performance
UNIVERSE_CACHE_ENABLED=0
UNIVERSE_CACHE_TTL_ANALYTICS=120
UNIVERSE_CACHE_TTL_AGENTIC=300

# Automazioni
UNIVERSE_ALERTS_ENABLED=0             # grafo → lead_alerts
UNIVERSE_WEBHOOKS_ENABLED=0           # outbound webhooks
UNIVERSE_EVENTS_ARCHIVE_DAYS=180
```

**Catena di attivazione consigliata staging:**
1. `UNIVERSE_ENABLED=1` → popola grafo da scrape
2. `UNIVERSE_READ_ENABLED=1` → badge hydrate in ricerca Maps
3. `NEXT_PUBLIC_UNIVERSE_UI=true` → UI Knowledge Graph
4. Dopo dati sufficienti: cache, alerts, webhooks, realtime

---

## 10. Test suite (`npm run test:universe`)

27 script concatenati, incluso `test:universe:e2e` che simula percorsi utente Fasi 5–10.

| Script | Cosa verifica |
|--------|---------------|
| `test-universe-sql-syntax` | Migration SQL parseable, tabelle/indici/funzioni |
| `test-universe-sdk` | Export barrel `index.ts` |
| `test-universe-python` | Ingest + worker sidecar unit test |
| `test-universe-schema` | Tabelle live Supabase (skip se rete) |
| `test-universe-rls` | RLS policies + service role write |
| `test-universe-integration` | Wiring worker/API |
| `test-universe-api` | Route files + import corretti |
| `test-universe-agentic` | UI Fase 5 + formatters |
| `test-universe-phase6` … `phase10` | Wiring per fase |
| `test-universe-e2e` | Journey end-to-end logic + optional live DB |
| `test-universe-graph-ranking` | Score alto/basso |

**Build gate:** `npm run build` — 123 route, TypeScript strict.

---

## 11. Flusso dati end-to-end (esempio utente)

### Scenario A — Ricerca Maps classica con hydrate

```
1. User avvia ricerca "software Milano" → trigger-scrape → worker
2. Worker: Maps + audit → searches.results JSONB
3. [UNIVERSE_ENABLED=1] sidecar ingest → universe_entities + observations
4. Frontend polling check-scrape-job
5. [UNIVERSE_READ_ENABLED=1] hydrateLeadsFromUniverse merge rating/pixel freschi
6. ResultsTable mostra UniverseHydratedBadge → click → /dashboard/universe/:id
```

### Scenario B — Agentic Search (zero crediti)

```
1. User: /dashboard/universe?q=edili+Roma+senza+pixel
2. POST /api/universe/agentic-search
3. parseSignalIntent(user_query) → SignalIntentSpec (heuristic + optional Claude)
4. signalIntentToUniverseQuery → executeUniverseQuery
5. rankUniverseEntities → sort by graph_score
6. entityToMiraxLeadRow × N → UI table + CSV export
```

### Scenario C — Evento → alert → webhook

```
1. cron website-change-detect rileva diff sito
2. appendEvent(website_changed) → universe_events processed=false
3. [ogni 2h] universe-process-events cron
4. dispatchUniverseEventAlerts → lead_alerts per utenti con entity in context
5. [UNIVERSE_WEBHOOKS_ENABLED=1] POST webhook + universe_webhook_deliveries
6. markEventProcessed → archive se > 180 giorni
```

---

## 12. Cosa è COMPLETO vs cosa MANCA

### 12.1 ✅ Completato in codice (Fasi 0–10)

- [x] Schema grafo 6+3 tabelle, RLS, helper SQL, 4 migration
- [x] SDK TS completo (28 moduli) + Python mirror
- [x] Ingest sidecar da tutti i punti legacy critici
- [x] 15 API Universe + 2 cron
- [x] UI Knowledge Graph 3 tab + entity detail + integrazioni ResultsTable
- [x] Agentic Search NL con trasparenza intent + Graph Rank
- [x] Hydrate read-back JSONB
- [x] Digital Twin + user context + Universe Agent
- [x] Realtime feed + analytics RPC + cache DB
- [x] Alerting + webhooks + archivio eventi
- [x] 27 test script + E2E journey
- [x] Documentazione modello dati

### 12.2 🟡 Completato in codice ma NON ancora operativo in produzione

| Gap | Azione richiesta |
|-----|------------------|
| Migration Fasi 8–10 su Supabase dev | `npm run db:apply-mirax` da macchina con rete |
| `UNIVERSE_ENABLED=1` su Vercel staging | Env vars dashboard Vercel |
| `UNIVERSE_ENABLED=1` su worker 116 | `.env` worker + restart |
| Grafo popolato con volume reale | Scrape staging + attesa ingest |
| Test schema/RLS live | `npm run test:universe:schema` (non SKIP) |
| Deploy ultimo commit su Vercel | `git push` + verify preview |

### 12.3 ❌ Non implementato — Roadmap v2 (nuova direzione incompleta)

#### A. Motore semantico / intelligence onnivora
| Feature | Stato | Note |
|---------|-------|------|
| LLM intent parsing (Claude) | ✅ Parziale | `parse-semantic.ts` esiste per Maps search, usato anche da agentic-search |
| Copertura query arbitrarie ("cercano CRM", "espandono organico") | 🟡 | Dipende da qualità parse + dati nel grafo |
| Evidence strutturata su ogni risultato Agentic | ❌ | Manca UI `evidence[]` per riga risultato grafo |
| Re-ranker ML | ❌ | Fase 10 = rule-based; roadmap v2 prevede ML su feature store |
| Embedding / semantic search sul grafo | ❌ | Solo filtri strutturati + name GIN |

#### B. Dati e ingest
| Feature | Stato |
|---------|-------|
| Popolamento massivo grafo da storico `searches` | 🟡 | Solo `universe-reconcile` weekly, non full backfill |
| Deprecazione JSONB (Fase 6 vision) | ❌ | Hydrate è additive, JSONB ancora source of truth |
| Entity resolution / merge automatico duplicati | 🟡 | `merged_into_id` esiste, UI merge mancante |
| Ingest hiring da fonti esterne (LinkedIn, Indeed) | ❌ | Solo se presente in lead enrichment |
| Registry / gare / bandi come eventi strutturati | 🟡 | Event types definiti, ingest parziale da business_events |

#### C. Piattaforma e infra
| Feature | Stato |
|---------|-------|
| Partitioning fisico PostgreSQL | ❌ | Archive table = partitioning logico |
| API pubblica grafo (API keys `/api/v1`) | ❌ |
| Rate limiting dedicato Universe API | ❌ |
| Osservabilità (metrics, tracing ingest) | ❌ |
| Feature flag per-tenant rollout | 🟡 | Solo env globali |

#### D. UX prodotto
| Feature | Stato |
|---------|-------|
| Notifiche push/email su alert grafo | ❌ | Solo `lead_alerts` in-app |
| Salvataggio risultati Agentic in lista/Ambiente | ❌ |
| Confronto grafo vs lead Maps side-by-side | ❌ |
| Graph visualization (D3/Cytoscape) | ❌ | Solo liste relazioni |
| Pitch generation da Digital Twin | 🟡 | Pipeline `graph_pitch` definita, UI limitata |

#### E. Multi-agent avanzato (manifesto ecosistema)
| Feature | Stato |
|---------|-------|
| Agent autonomo outreach | ❌ | HITL obbligatorio per design |
| Orchestrazione multi-agent cross-domain | 🟡 | Registry esiste, pochi agent collegati al grafo |
| Zoom/Glean-style knowledge injection | ❌ | Fuori scope attuale |

#### F. Ops produzione
| Feature | Stato |
|---------|-------|
| Promozione Universe su miraxgroup.it (Copia) | ❌ | Dev only per policy |
| Worker 178 produzione con Universe | ❌ |
| Supabase produzione migration | ❌ |
| Runbook incident ingest failure | ❌ |
| Dashboard ops drift reconcile | ❌ |

### 12.4 Definition of Done per "nuova direzione completa"

La **nuova direzione** (MIRAX = motore intelligence B2B onnivoro + grafo commerciale) si considera **chiusa al 100%** quando:

1. **Dati:** Grafo staging con >10k company, osservazioni <30gg, eventi hiring/website attivi.
2. **Prod ops:** Env attivi su Vercel + worker 116, migration applicate, schema test PASS.
3. **UX:** Utente può fare query NL arbitraria, vedere evidence, esportare, salvare in pipeline — senza tornare a Maps per lo stesso intent.
4. **Automazioni:** Alert + webhook verificati E2E con Zapier/Make test endpoint.
5. **Qualità:** `npm run test:universe` + E2E live DB PASS, non SKIP.
6. **v2 (opzionale ma strategico):** ML re-ranker, graph viz, API pubblica, backfill storico completo.

**Stima stato attuale:** ~**75%** implementazione codice Fasi 0–10 · ~**30%** operativizzazione staging · ~**15%** visione prodotto onnivora completa.

---

## 13. Comandi operativi rapidi

```bash
# Repo
cd "WEB APP CKB - Dev"

# Test completi
npm run test:universe
npm run test:universe:e2e
npm run build

# Migration Supabase dev
npm run db:apply-mirax

# Verifica schema live
npm run test:universe:schema
npm run test:universe:rls

# Deploy worker staging (da backend_mirror)
./scripts/deploy-staging.sh
```

---

## 14. Diagramma architettura finale

```mermaid
flowchart TB
  subgraph Legacy
    Maps[Maps Scrape]
    JSONB[searches.results JSONB]
    Pipeline[lead_pipeline]
  end

  subgraph Ingest["Write UNIVERSE_ENABLED=1"]
    Worker[worker_supabase.py]
    Enrich[enrich-lead]
    Reaudit[reaudit cron]
  end

  subgraph Graph[Supabase Graph]
    Ent[universe_entities]
    Obs[universe_observations]
    Rel[universe_relationships]
    Ev[universe_events]
    Ctx[universe_user_context]
    Cache[universe_query_cache]
    WH[universe_webhook_deliveries]
  end

  subgraph Read["Read UNIVERSE_READ_ENABLED=1"]
    Hydrate[check-scrape-job hydrate]
    Agentic[agentic-search API]
    APIs[universe APIs]
  end

  subgraph UI[Dashboard]
    Page[/dashboard/universe]
    Twin[Digital Twin]
    RT[Live Events Feed]
  end

  subgraph Cron
    Proc[universe-process-events]
    Recon[universe-reconcile]
  end

  Maps --> JSONB
  Worker --> Ent
  Enrich --> Ent
  Reaudit --> Ev
  Ent --> Obs
  Ent --> Rel
  JSONB --> Hydrate
  Hydrate --> Obs
  Agentic --> Ent
  APIs --> Page
  Ev --> Proc
  Proc --> Alerts[lead_alerts]
  Proc --> WH
  Page --> Twin
  Ev --> RT
```

---

*Fine documento. Per modifiche allo schema vedere `docs/UNIVERSE_DATA_MODEL.md`. Per task operativi deploy vedere prompt Fasi 1–4 in transcript chat e `scripts/apply-mirax-migrations.mjs`.*
