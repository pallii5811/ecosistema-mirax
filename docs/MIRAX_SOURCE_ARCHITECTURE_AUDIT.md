# MIRAX Source Architecture Audit

Checkpoint verificato: branch `safety/mirax-v5-11-codex-checkpoint`, SHA `a6a1194724e25697d8ac1ca59a776a1423f7d73e`. Audit statico e replay offline; nessun provider, canary o deploy.

## Conclusione esecutiva

Il nucleo di controllo e' reale: compiler canonico, ontology, cost governor, entity/domain resolution, audit tecnico, evidence gate, lifecycle e pubblicazione atomica esistono e sono testati. Il blocco non e' il gate finale: e' l'acquisizione source-first. Il registry descrive 15 classi di fonte, ma non esiste un contratto `SourceAdapter` comune e il planner puo' selezionare lane che il runtime traduce soltanto in query SERP. Gli adapter ANAC/TED e hiring esistenti sono prevalentemente enrichment **company-first**: richiedono un'azienda gia' scoperta; non producono in modo paginato un universo di aziende da una query commerciale.

Il canary hiring ha quindi attraversato un percorso costoso e rumoroso: 71 URL SERP -> 13 pagine -> 4 entita -> 0 evidenze pubblicabili -> 0 qualified. Il lifecycle ha correttamente respinto tutto. Il pre-filtro del commit corrente elimina le careers generiche prima dell'estrazione a pagamento, ma non sostituisce un Hiring Adapter discovery-first.

## Percorso reale dal codice

| Passaggio | File e simbolo reale | Input -> output | Stato | Difetto / blocco attuale |
|---|---|---|---|---|
| Query/UI | `src/app/dashboard/unified-search-action.ts`: `unifiedSearchAction`, `unifiedSearchActionCore` | stringa, max lead, utente -> piano/job | IMPLEMENTATO | Convive con routing legacy Maps e payload legacy. |
| Compiler canonico | `src/lib/intent-compiler/compile-commercial-search-plan.ts`: `compileCommercialSearchPlan` | query -> `CommercialSearchPlan` Zod | IMPLEMENTATO | Dipende da Anthropic; fallback separato non e' semanticamente equivalente. |
| Schema compiler | `src/lib/contracts/commercial-search-plan.ts`: `CommercialSearchPlanSchema` | payload LLM -> piano validato | IMPLEMENTATO | Non prova che le source class richieste abbiano un adapter eseguibile. |
| Fallback intent | `src/lib/uqe/mirax-query-planner.ts`: `buildHeuristicMiraxQueryPlan` | query -> `MiraxQueryPlan` | PARZIALE | Replay: perde `tender_won`, confonde marketing con hiring/expansion e non mappa `hiring_operational` alla job lane. |
| Ontology | `contracts/signal-ontology.v1.json`; `src/lib/signal-ontology/ontology.ts`; `backend_mirror/contracts/signal_ontology.py` | alias/segnale -> definizione e fonti probabili | IMPLEMENTATO | Le fonti sono capability dichiarate, non implementazioni verificate. |
| Source registry | `contracts/source-registry.v1.json`; loader TS/Python | source id -> trust/costo/freshness | SOLO PLANNER | Dichiara `structured_connector` per registry/procurement e browser ads, ma non lega l'id a un adapter runtime. |
| Source planner | `src/lib/uqe/mirax-query-planner.ts`: `defaultSourcePlan`, `sourcePlanForCommercialHypothesis`, `canonicalPlanToLegacy` | segnali -> lane/template/source_types | PARZIALE | Puo' nominare ANAC, TED, Meta Ad Library, registry, municipal register o job board senza invocarne il connettore. |
| Routing | `src/lib/uqe/execute-plan.ts`: `executeMiraxQueryPlan` | piano -> graph/maps/agentic job | IMPLEMENTATO | Solo quattro strategie grossolane; nessun routing per adapter/capability. |
| Job worker | `backend_mirror/worker_supabase.py` | job Supabase -> raw/audit/lifecycle | IMPLEMENTATO | Grande orchestratore legacy; mescola Maps, enrich, audit e v5. |
| Query generation v5 | `backend_mirror/agents/web_researcher.py`: `_source_plan_query_specs`, `_heuristic_search_queries` | lane -> query testuali | PARZIALE | Ogni lane diventa testo SERP; `source_types` resta metadata. |
| SERP | `backend_mirror/agents/search_serp.py`: `search_urls_http` e provider helper | query -> URL | IMPLEMENTATO | Serper/Brave/DDG trovano pagine, non record strutturati; ranking e recall dipendono dall'indice web. |
| Fetch | `WebResearcher.iter_scraped_pages`, `_scrape_url` | URL -> testo pagina | IMPLEMENTATO | Playwright lancia molte pagine; nessuna paginazione specifica di fonte o cursor persistente. |
| Pre-filter/ranking | `agents/data_extractor.py`: `page_has_required_signal`; `agents/hiring_evidence.py`; `agentic_gap_fill.rank_pages_for_extraction` | testo -> accetta/ordina | IMPLEMENTATO (hiring) | Gate mirato, non un adapter; per altri segnali restano keyword generiche. |
| Extraction | `backend_mirror/agents/data_extractor.py`: `DataExtractor.extract_page`, `_llm_extract_companies` | testo -> lead estratti | IMPLEMENTATO | LLM vede fonti eterogenee; schemi legacy e alias segnale possono perdere specificita'. |
| Candidate boundary | `backend_mirror/agents/agentic_gap_fill.py`: `prepare_agentic_extracted_item` | extracted -> candidate stub | PARZIALE | Molti campi canonici vengono ricostruiti da payload legacy; date e signal id possono degradare. |
| Entity/domain | `backend_mirror/agents/domain_resolver.py`: `resolve_company_identity`; `agentic_gap_fill.prepare_agentic_extracted_item` | nome/sito -> dominio e identity proof | IMPLEMENTATO | Funziona quando la pagina identifica davvero l'azienda; non risolve source publisher scambiati per buyer. |
| Audit tecnico/contatti | `backend_mirror/audit_engine.py`: `run_technical_audit`; `backend_mirror/adaptive_audit.py`; worker audit flow | dominio -> report, contatti, tecnologia | IMPLEMENTATO per Digital Audit | E' candidate-first; non crea da solo candidati per segnali arbitrari. |
| Enrichment esterno | `backend_mirror/waterfall_enrich.py`: `EnrichmentSource`, `WaterfallEnricher`; `business_events_enrich.py` | lead noto -> signal | PARZIALE | ANAC/TED/Indeed/InfoJobs sono adapter di enrichment, non discovery-first, e non usano il contratto v5. |
| Evidence/freshness | `backend_mirror/commercial_lifecycle.py`: `_canonical_evidence`, `evaluate_publication_gate` | candidate + plan -> gate/evidence | IMPLEMENTATO | Fail-closed corretto; espone i difetti upstream (`published_at`, publisher, signal id, size). |
| Target fit | `commercial_lifecycle.py`: `positive_entity_classification`, `evaluate_publication_gate` | entity/payload -> buyer/SME fit | PARZIALE | La dimensione PMI spesso manca; il rejection code `ENTITY_NOT_OPERATING` puo' mascherare size unknown. |
| Persistenza | `commercial_lifecycle.py`: `persist_and_publish_candidates` | candidate/gate -> tabelle v5 | IMPLEMENTATO | Contratti DB migliori del payload legacy; input upstream non li popola sempre. |
| Pubblicazione | `db/migrations/2026_07_14_atomic_publication_credit.sql`: `publish_search_candidate` | qualified row -> publication/charge atomici | IMPLEMENTATO | Non blocca la discovery, blocca correttamente candidati incompleti. |

## Trace offline di tre query

La colonna fallback deriva dall'esecuzione locale di `buildHeuristicMiraxQueryPlan`; non e' stata effettuata alcuna chiamata LLM.

### A. Imprese edili a Torino che hanno vinto gare negli ultimi giorni

- Buyer richiesto: imprese edili operative, preferibilmente PMI, Torino.
- Segnale corretto: `contract_awarded`/alias `tender_won`, award date recente, aggiudicatario esplicito.
- Piano canonico atteso: lane `public_procurement`, source `public_procurement_portal`, poi dominio ufficiale/audit.
- Fallback reale: `strategy=maps`, `sector=imprese edili`, `location=Torino`, `required_signals=[]`; lane news/company_web/web_evidence.
- Fonte realmente interrogata nel v5 agentic, quando la lane esiste: SERP con `site:anac.gov.it`, `site:ted.europa.eu` o testo aggiudicazione; non il local ANAC index come discovery.
- Componenti riusabili: `anac_indexer.py`, `anac_client.py`, `waterfall_enrich.ANACSource`, `TEDSource`, entity/domain/lifecycle.
- Punto di degrado: intent fallback prima; poi source planner -> SERP invece di record award paginati. Inoltre `ANACSource.fetch` richiede gia' il nome azienda.
- Per 20/100/500/5.000: query strutturata per intervallo/geografia/CPV, cursor su award, estrazione aggiudicatario/C.F./CIG/importo/data, entity resolution batch, dedup e checkpoint. SERP non puo' garantire exhaustion o volume.

### B. Aziende in Lombardia che investono concretamente in marketing

- Buyer: aziende/PMI operative in Lombardia.
- Segnale corretto: `active_advertising` (inserzione attiva collegata al dominio/advertiser) ed eventualmente landing/funnel osservato; pixel assente non prova investimento.
- Piano canonico atteso: `ad_transparency_library` + `technology_audit`, con advertiser/landing-domain match e data osservazione.
- Fallback reale: `strategy=organic_web_search`, ma `required_signals=[hiring, expansion]` perche' “marketing” viene interpretato come ruolo; lane job_market/real_estate/events/partnerships/news.
- Fonte realmente interrogata: SERP generica. Il lookup Meta esiste nel client/audit per lead gia' noto (`useSignalIntentEnrich.ts`, `marketing-investment.ts`), non come discovery paginata di aziende lombarde.
- Punto di degrado: intent fallback; assenza di Ads Adapter discovery-first; possibile confusione agenzia/advertiser/brand.
- Per 20/100/500/5.000: candidate universe PMI Lombardia, verifica bulk Ad Library consentita, landing-domain ownership, audit tecnico e cursor. Se l'API non consente discovery esaustiva, dichiarare copertura parziale e usare candidate-first verification con un universo dichiarato.

### C. PMI italiane che assumono personale operativo

- Buyer: PMI italiane operative; segnale `hiring_operational`; ruoli operai/autisti/magazzinieri/installatori/manutentori/tecnici; vacancy fresca.
- Piano canonico atteso: `company_careers` e `job_board`, company identity, ruolo, location e published/expiry date.
- Fallback reale: `strategy=hybrid`, `required_signals=[hiring_operational]`, ma lane news/company_web/web_evidence; `defaultSourcePlan` apre job_market solo per `hiring` esatto.
- Fonte realmente interrogata nell'ultimo canary: SERP -> careers generiche -> Playwright -> extractor. Gli adapter Indeed/InfoJobs/Google/LinkedIn esistono, ma richiedono il nome dell'azienda e sono usati come enrichment.
- Punto di degrado: source selection generica, poi vacancy/date/PMI insufficienti. Il nuovo pre-filtro elimina la navigazione ma non crea recall.
- Per 20/100/500/5.000: adapter job discovery per ruolo/geografia, JSON-LD/ATS parsers, pagination/cursor, canonical employer resolution, vacancy freshness e size verification. Per 5.000 servono shard geografici/ruolo, cache e resume; non moltiplicare query LLM.

## Diagnosi dell'implementazione esistente

| Categoria | Componenti | Decisione |
|---|---|---|
| Validi e riusabili | schema compiler, ontology, cost governor, SERP fallback, audit tecnico, entity/domain resolver, lifecycle, DB gates, publication RPC | Mantenere e mettere dietro contratti unici. |
| Validi ma non collegati | ANAC local index/client, TED source, hiring sources, WaterfallEnricher, Meta verification, Universe relation extractors | Collegare tramite adapter discovery/enrichment espliciti; non duplicare parser. |
| Duplicati | ontology/alias TS e Python + tipi legacy; hiring in `hiring_sources`, `business_events_enrich`, `waterfall_enrich`, WebResearcher; tender in ANAC client, waterfall e universe | Scegliere un adapter canonico e lasciare wrapper legacy sottili. |
| Contratti incompatibili | `CommercialSearchPlan` vs `MiraxQueryPlan`; source registry vs `EnrichmentSource`; generic `hiring` vs `hiring_operational`; `evidence_date` observation vs `published_at`; payload nested vs colonne v5 | Introdurre boundary mapper unico e vietare alias dopo il planner. |
| Complessita' non produttiva | source lane decorative, molte euristiche query-specific, worker monolitico, LLM extraction su pagine non qualificate | Ridurre solo lungo il percorso adapter -> candidate -> evidence. Nessun mega-refactor. |
| Da rimuovere/deprecare | claim “structured_connector” senza binding runtime; Google HTML come pseudo Google Jobs; GNews token demo; evidence generica creata da titolo/snippet | Fail capability check; mantenere soltanto fallback dichiarati non pubblicabili. |
| Mancanti | SourceAdapter contract/catalog, discovery-first procurement/hiring/ads-expansion, cursor/exhaustion, adapter run ledger, canonical opportunity/evidence mapper, volume resume | Sono il lavoro critico. |

Misura non arbitraria: il registry elenca 15 source class, ma zero implementano oggi un'interfaccia `SourceAdapter` comune con discover/fetch/paginate/exhaustion. Delle 10 famiglie richieste, Digital Audit ha un percorso end-to-end reale su aziende candidate; procurement e hiring hanno connettori company-first parziali; le altre sette dipendono principalmente da SERP, audit candidate-first o componenti nominati soltanto nel planner. L'infrastruttura di validazione e sicurezza e' piu' matura dell'acquisition.

## Architettura definitiva

Flusso: `CommercialSearchPlan -> AdapterCapabilityResolver -> AdapterRun[] -> OpportunityCandidate -> EntityResolver -> EvidenceRecord[] -> Audit -> Lifecycle -> QualifiedLead -> atomic publication`.

```ts
type AdapterCost = { currency: 'EUR'; reservePerCall: number; reservePerPage: number; hardRunCap: number }
type AdapterCursor = { value: string | null; exhausted: boolean; checkpoint: Record<string, unknown> }

interface SourceAdapter {
  id: string; version: string
  supportedIntents: string[]; supportedSignals: string[]
  geography: { countries: string[]; subdivisions: boolean }
  freshness: { field: string; maximumAgeDays: number; semantics: 'published'|'updated'|'observed' }
  pagination: { kind: 'cursor'|'offset'|'page'|'none'; maxPageSize: number; resumable: boolean }
  cost: AdapterCost; retry: { attempts: number; retryableCodes: string[] }
  discover(ctx: AdapterContext, cursor: AdapterCursor): Promise<DiscoveryPage>
  fetch(ref: SourceReference, ctx: AdapterContext): Promise<FetchedArtifact>
  extractEntities(artifact: FetchedArtifact, ctx: AdapterContext): Promise<EntityClaim[]>
  extractEvidence(artifact: FetchedArtifact, entity: EntityClaim, ctx: AdapterContext): Promise<EvidenceRecord[]>
  exhaustion(page: DiscoveryPage): AdapterCursor
}

type OpportunityCandidate = {
  candidateId: string; searchId: string; adapterId: string; intentId: string
  entity: { name: string; legalName?: string; vatId?: string; websiteHint?: string; geography?: string }
  signalIds: string[]; sourceRef: SourceReference; selectionScore: number
  observedAt: string; provenance: { query: string; cursor: string|null; artifactHash: string }
}

type EvidenceRecord = {
  evidenceId: string; candidateId: string; signalId: string
  factType: 'observed_fact'|'derived_fact'|'commercial_inference'
  claimType: string; claimValue: string; excerpt: string
  source: { adapterId: string; class: string; url: string; publisher: string; primary: boolean }
  publishedAt: string|null; observedAt: string; expiresAt: string|null
  confidence: number; verification: 'single_source'|'primary_source_verified'|'corroborated'
  contradiction: 'none'|'suspected'|'confirmed'; extractionMethod: string; contentHash: string
}

type QualifiedLead = {
  candidateId: string; entityName: string; legalName: string; canonicalDomain: string
  entityType: 'company'|'professional'; operatingBuyer: true; targetFitVerified: true
  signalIds: string[]; evidenceIds: string[]; whyNow: string
  contacts: { email?: string; phone?: string; social?: string[]; sourceUrls: string[] }
  scores: { buyerFit: number; signal: number; freshness: number; evidence: number; contactability: number; total: number }
  costEur: number; qualifiedAt: string; lifecycleVersion: string
}
```

Regole vincolanti:

1. Il catalogo runtime registra soltanto adapter istanziabili e healthy; il planner interseca ontology con capability reali.
2. Una lane senza adapter diventa `coverage_gap`, non una falsa integrazione.
3. SERP e' adapter fallback `generic_web` con copertura non esaustiva e non pubblicabile da snippet.
4. Il published date non puo' essere sostituito silenziosamente con crawl time.
5. Ogni adapter persiste cursor, costo, query, artifact hash, produced/rejected counts ed exhaustion.
6. Il lifecycle non viene indebolito; i mapper upstream devono soddisfarne il contratto.

## Ordine di consegna

1. Preservare e congelare Digital Audit con fixture/regressioni.
2. Contratti e catalogo adapter + capability gate nel planner.
3. Procurement Adapter discovery-first su ANAC local index e TED.
4. Hiring Adapter discovery-first su careers/ATS/job board consentiti.
5. Marketing Investment e Expansion Adapter, con copertura esplicitamente parziale quando necessario.
6. Orchestrazione universale e fallback dichiarato.
7. Batch 20, poi 100, 500 e 5.000 soltanto dopo exhaustion/cursor/costo/precision gate.

La sequenza file-per-file e' in `docs/MIRAX_CURSOR_HANDOFF.md`; il prompt esecutivo e' in `docs/MIRAX_CURSOR_EXECUTION_PROMPT.md`.
