# MIRAX Universe Data Model (UDM)

## Visione

Universe è il nuovo modello dati commerciale di MIRAX. Trasforma ogni dato raccolto — aziende, persone, siti, tecnologie, job, eventi — in un grafo di entità collegate, con storia temporale e eventi.

Principi guida:

1. **Ogni cosa è un'entità** o una relazione tra entità.
2. **Ogni attributo ha una storia**: quando è stato osservato, da quale fonte, con quale confidenza.
3. **Eventi append-only**: ogni cambiamento rilevante diventa un evento nello stream.
4. **Idempotenza**: lo stesso ingest può essere rieseguito senza duplicati.
5. **Sidecar**: Universe convive con il modello legacy (`searches.results`, `lead_pipeline`) fino a deprecazione graduata.

---

## Entità

Un'entità è qualsiasi oggetto del mondo reale rilevante per il commercio B2B.

### Tipi di entità

| `entity_type` | Descrizione | Esempio `canonical_id` |
|---|---|---|
| `company` | Azienda | dominio normalizzato (es. `miraxgroup.it`) o P.IVA |
| `person` | Persona fisica | LinkedIn URL o email hash |
| `website` | Sito web | URL normalizzato |
| `technology` | Tecnologia rilevata | slug tecnologia (es. `wordpress`, `meta_pixel`) |
| `job` | Annuncio di lavoro | URL annuncio Indeed/InfoJobs |
| `event` | Evento business rilevato | UUID generato |
| `document` | Documento pubblico (gara, atto, notizia) | URL documento |
| `product` | Prodotto/servizio venduto | slug prodotto |
| `location` | Località geografica | `it:roma` |

### Tabella `universe_entities`

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
canonical_id TEXT NOT NULL              -- identificatore stabile e deduplicante
entity_type TEXT NOT NULL               -- vedi tabella sopra
name TEXT NOT NULL
slug TEXT                               -- versione URL-friendly del nome
country TEXT DEFAULT 'IT'
city TEXT
region TEXT
metadata JSONB DEFAULT '{}'::jsonb      -- dati specifici del tipo (es. partita iva, forma giuridica)
merged_into_id UUID REFERENCES universe_entities(id)  -- deduplicazione
confidence NUMERIC DEFAULT 1.0          -- confidenza dell'esistenza dell'entità
first_seen_at TIMESTAMPTZ               -- prima volta che MIRAX l'ha vista
last_seen_at TIMESTAMPTZ                -- ultima volta
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
UNIQUE(canonical_id, entity_type)
```

**Regola di canonicalizzazione**: `canonical_id` deve essere deterministico e normalizzato. Vedi `src/lib/universe/canonical.ts`.

---

## Osservazioni (Temporal Database)

Un'osservazione è un fatto rilevato su un'entità in un momento specifico.

### Tabella `universe_observations`

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE
attribute TEXT NOT NULL                 -- nome attributo (es. meta_pixel, revenue, employees)
value JSONB NOT NULL                    -- valore osservato
observed_at TIMESTAMPTZ NOT NULL        -- momento dell'osservazione
source TEXT NOT NULL                    -- fonte (maps, audit, openapi, indeed, anac, claude, user)
confidence NUMERIC DEFAULT 1.0          -- confidenza 0.0 - 1.0
metadata JSONB DEFAULT '{}'::jsonb      -- contesto (URL, snippet, job_title, ...)
created_at TIMESTAMPTZ DEFAULT now()
```

### Attributi standard

| Attributo | Entità | Tipo value | Fonti |
|---|---|---|---|
| `name` | company | string | maps, openapi, linkedin |
| `legal_name` | company | string | openapi |
| `vat_number` | company | string | openapi, user |
| `employees` | company | number | openapi, claude |
| `revenue` | company | number | openapi, claude |
| `founded_year` | company | number | openapi, claude |
| `legal_form` | company | string | openapi, claude |
| `rating` | company | number | maps |
| `reviews_count` | company | number | maps |
| `meta_pixel` | website/company | boolean | audit |
| `google_tag_manager` | website/company | boolean | audit |
| `google_analytics` | website/company | boolean | audit |
| `ssl` | website | boolean | audit |
| `mobile_friendly` | website | boolean | audit |
| `seo_disaster` | website | boolean | audit |
| `load_speed_seconds` | website | number | audit |
| `has_spf` | website | boolean | audit |
| `has_dmarc` | website | boolean | audit |
| `category` | company | string | maps, nlp |
| `address` | company | string | maps |
| `phone` | company | string | maps, audit, sito |
| `email` | company | string | sito, user |
| `job_title` | job | string | indeed, infojobs |
| `job_location` | job | string | indeed, infojobs |

---

## Relazioni

Le relazioni collegano entità in un grafo diretto.

### Tabella `universe_relationships`

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
source_entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE
target_entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE
relationship_type TEXT NOT NULL         -- vedi tabella sotto
confidence NUMERIC DEFAULT 1.0
observed_at TIMESTAMPTZ NOT NULL
source TEXT NOT NULL
metadata JSONB DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ DEFAULT now()
UNIQUE(source_entity_id, target_entity_id, relationship_type)
```

### Tipi di relazione

| `relationship_type` | Sorgente | Target | Significato |
|---|---|---|---|
| `owns` | company | website | L'azienda possiede il sito |
| `uses` | company/website | technology | Usa una tecnologia |
| `hires` | company | job | Ha pubblicato un annuncio |
| `has` | company | person | Ha una persona (dipendente, decision maker) |
| `receives` | company | event | Subisce un evento business |
| `buys` | company | product | Potenzialmente acquista un prodotto/servizio |
| `competes_with` | company | company | Competitor locale o di settore |
| `located_in` | company | location | Localizzazione geografica |
| `related_to` | company | company | Relazione generica (partner, fornitore) |
| `mentioned_in` | company/person | document | Citato in un documento |

---

## Eventi

Gli eventi rappresentano cambiamenti significativi. Sono append-only.

### Tabella `universe_events`

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
entity_id UUID REFERENCES universe_entities(id) ON DELETE SET NULL
event_type TEXT NOT NULL                -- vedi tabella sotto
payload JSONB NOT NULL                  -- dati dell'evento
occurred_at TIMESTAMPTZ NOT NULL        -- quando è avvenuto
processed_at TIMESTAMPTZ                -- quando il consumer l'ha processato
source TEXT NOT NULL
processed BOOLEAN DEFAULT false
error_count INTEGER DEFAULT 0
error_message TEXT
created_at TIMESTAMPTZ DEFAULT now()
```

### Tipi di evento

| `event_type` | Significato | Esempio payload |
|---|---|---|
| `website_changed` | Cambiamento sito web | `{ url, diff_hash, old_snapshot_id }` |
| `pixel_installed` | Meta pixel installato | `{ attribute: 'meta_pixel', old_value: false, new_value: true }` |
| `pixel_removed` | Meta pixel rimosso | idem |
| `new_hiring` | Nuova assunzione/offerta | `{ job_title, job_url, source: 'indeed' }` |
| `new_director` | Nuovo legale rappresentante | `{ name, role, source: 'openapi' }` |
| `crm_installed` | CRM rilevato | `{ crm: 'hubspot' }` |
| `tender_won` | Gara vinta | `{ authority, amount, url }` |
| `funding_received` | Finanziamento ricevuto | `{ amount, round, source }` |
| `registry_change` | Cambio registro imprese | `{ change_type, description }` |
| `revenue_changed` | Fatturato cambiato | `{ old_value, new_value }` |
| `employees_changed` | Dipendenti cambiati | `{ old_value, new_value }` |

---

## Alias

Gli alias permettono di risolvere la stessa entità da identificatori diversi.

### Tabella `universe_entity_aliases`

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
entity_id UUID NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE
alias_type TEXT NOT NULL                -- domain, vat, linkedin, phone, email, name_variant
alias_value TEXT NOT NULL
confidence NUMERIC DEFAULT 1.0
created_at TIMESTAMPTZ DEFAULT now()
UNIQUE(entity_id, alias_type, alias_value)
```

---

## Contesto utente

Le entità sono globali, ma il contesto utente è privato.

### Tabella `universe_user_context`

```sql
user_id UUID REFERENCES auth.users(id)
entity_id UUID REFERENCES universe_entities(id)
context_type TEXT NOT NULL              -- saved, contacted, pipeline, ignored, note, hidden
metadata JSONB DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
PRIMARY KEY (user_id, entity_id, context_type)
```

---

## Convenzioni di codice

### TypeScript (`src/lib/universe/`)

- Ogni repository deve esporre funzioni pure e idempotenti.
- Nessuna logica di business nei repository.
- Gli errori di Supabase devono essere wrappati in errori con `code` descrittivo.
- I tipi devono essere condivisi tra frontend e backend.

### Python (`backend_mirror/universe/`)

- Usare `dataclasses` per i modelli.
- Repository stateless che accettano client Supabase come parametro.
- Gestione esplicita di retry e idempotenza.

### Canonical IDs

- **Dominio**: lowercase, rimuovi `www.`, rimuovi path, rimuovi query. Esempio: `MiraxGroup.IT` → `miraxgroup.it`.
- **P.IVA**: solo cifre, prefix `IT:` se italiana. Esempio: `IT12345678901`.
- **Telefono**: E.164 semplificato, rimuovi spazi e `+39`. Esempio: `+39 333 123 4567` → `393331234567`.
- **Email**: lowercase.
- **LinkedIn URL**: normalizza a `linkedin.com/in/<slug>` o `linkedin.com/company/<slug>`.
- **Slug tecnologia**: lowercase, underscore. Esempio: `Meta Pixel` → `meta_pixel`.
- **Slug location**: `it:roma`, `it:milano`, ecc.

---

## Ingest rules

### Da LeadResult (Maps + audit)

1. Crea/aggiorna `company` con `canonical_id = normalized_domain` o `normalized_phone` se manca dominio.
2. Crea/aggiorna `website` con relazione `company owns website`.
3. Per ogni tecnologia in `tech_stack`: crea `technology` + relazione `company uses technology`.
4. Per ogni attributo audit: scrivi `observation`.
5. Per ogni segnale business: scrivi `event` + `observation`.

### Da ClayEnrichedLead

1. Cerca `company` per dominio.
2. Aggiungi alias (P.IVA, LinkedIn, email, telefono).
3. Aggiungi observations da OpenAPI, social, registry.
4. Aggiungi relazioni con persone (decision maker) se presenti.

### Da business signal

1. Risolvi `company` per dominio/P.IVA/nome.
2. Se il segnale è un job: crea `job` + relazione `company hires job`.
3. Se il segnale è un evento (tender, funding, registry): crea `event` + relazione `company receives event`.
4. Scrivi `observation` per ogni attributo estratto.
5. Scrivi `universe_event` per cambiamenti rilevanti.

---

## Query patterns

### Trova aziende per attributo

```sql
SELECT e.*, o.value
FROM universe_entities e
JOIN LATERAL (
  SELECT value FROM universe_observations
  WHERE entity_id = e.id AND attribute = 'meta_pixel'
  ORDER BY observed_at DESC LIMIT 1
) o ON true
WHERE e.entity_type = 'company'
  AND e.city = 'Roma'
  AND o.value = false;
```

### Trova aziende che assumono

```sql
SELECT c.*
FROM universe_entities c
JOIN universe_relationships r ON r.source_entity_id = c.id
JOIN universe_entities j ON j.id = r.target_entity_id
WHERE r.relationship_type = 'hires'
  AND j.entity_type = 'job'
  AND j.metadata->>'title' ILIKE '%programmatore%';
```

### Timeline di un'azienda

```sql
SELECT attribute, value, observed_at, source
FROM universe_observations
WHERE entity_id = :entity_id
ORDER BY observed_at DESC;
```

---

## Roadmap di migrazione

1. **Fase 1-2**: Schema + SDK.
2. **Fase 3**: Popolare sidecar dal worker/backend.
3. **Fase 4**: API di lettura dal grafo.
4. **Fase 5**: Agentic Search v0.
5. **Fase 6**: Deprecazione graduata JSONB.
6. **Fase 7**: Digital Twin (snapshot grafo + contesto utente) + Universe Agent multi-agent.
7. **Fase 8**: Realtime `universe_events`, analytics RPC, live feed UI, cron consumer eventi.
8. **Fase 9**: Cache query/analytics DB-backed, alerting grafo → `lead_alerts`, purge cron.
9. **Fase 10**: Graph ranking Agentic Search, webhook outbound eventi, archivio retention eventi.
10. **Roadmap v2**: ML re-ranker, partitioning fisico, API pubblica grafo.

---

## RLS e sicurezza

- `universe_entities`, `universe_observations`, `universe_relationships`, `universe_events` sono **pubblici in lettura** (dati aggregati da fonti pubbliche).
- Scrittura solo via `service_role` o specifici RLS per admin.
- `universe_user_context` è **privato** per `user_id`.
- Nessun PII diretto in `universe_entities` (email/telefono solo come alias hashati o in contesto privato).
