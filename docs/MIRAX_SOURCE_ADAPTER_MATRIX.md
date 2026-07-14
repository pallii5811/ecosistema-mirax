# MIRAX Source Adapter Matrix

Questa matrice descrive il runtime esistente, non le fonti nominate nei prompt. “Discovery-first” significa che la fonte puo' partire da segnale/geografia e produrre aziende; “company-first” significa che richiede gia' nome/dominio/P.IVA.

## Matrice per famiglia

| Famiglia | Adapter/runtime esistente | Fonti effettivamente interrogate | Pagination/freshness/entity/evidence | Copertura e volume | Stato reale | Gap prioritario |
|---|---|---|---|---|---|---|
| A. Criticita' digitali | `audit_engine.run_technical_audit`, `adaptive_audit`, Maps/worker legacy | sito ufficiale via HTTP/Playwright; Maps per categorie precise | crawl bounded; freshness=observation; entity da Maps/sito; evidence diretta su HTML/tag/SEO/contatti | globale per dominio; volume dipende dal seed Maps/DB | ADAPTER FUNZIONANTE candidate-first | Formalizzare `DigitalAuditAdapter`; preservare flusso legacy e separare discovery da audit. |
| B. Gare/agggiudicazioni | `anac_indexer.py`, `anac_client.py`; `waterfall_enrich.ANACSource/TEDSource` | SQLite ANAC locale e TED API **solo per azienda nota**; v5 discovery usa SERP `site:anac/ted` | ANAC max records; TED page 1/limit 5; date/CIG/importo parziali; evidence strutturata ma enrichment | Italia/UE; volume non esposto per query geography/date | INTEGRAZIONE INCOMPLETA | Adapter discovery-first con cursor per award date/region/CPV e winner extraction. |
| C. Assunzioni | `business_events_enrich.detect_hiring_signal`; `hiring_sources`; `WebsiteCareersSource` | Indeed HTML, InfoJobs page 1, Google HTML, LinkedIn via Google, careers | quasi sempre page 1; date spesso crawl-time; employer match fragile; careers parsing HTML | Italia/global; non esaustivo e non resumable | INTEGRAZIONE INCOMPLETA | Adapter discovery-first per role/location; JSON-LD/ATS parser, real posted/expiry date, canonical employer. |
| D. Investimenti marketing | UI `useSignalIntentEnrich`; `marketing-investment.ts`; audit fields Meta | Meta Ad Library per lead noto quando configurata; landing/tag audit; v5 discovery SERP | nessun cursor advertiser; observation freshness; domain/advertiser match non centralizzato | candidate-first; volume non stimabile | INTEGRAZIONE INCOMPLETA | Ads adapter con capability reale o candidate-universe verification; mai inferire spesa da pixel/SEO. |
| E. Espansioni/sedi/impianti | nessun adapter dedicato; `WebResearcher` + `DataExtractor`; news enrichment | SERP, news, sito ufficiale; `municipal_register` solo nome nel registry/planner | pagination SERP; date estratte da testo; entity LLM/domain resolver | open web, non esaustivo | RICERCA SERP GENERICA | Adapter municipal/permit/news feeds con event date, company party role e status planned/started/completed. |
| F. Finanziamenti | `waterfall_enrich.NewsAPISource` company-first; WebResearcher | NewsAPI/GNews e SERP startup/news; registry dichiarato ma non connesso | pageSize 3 per company; freshness articolo; recipient extraction debole | Italia/global, recall ignoto | INTEGRAZIONE INCOMPLETA | Funding adapter con feed/registry strutturato, round recipient, amount, close date e pagination. |
| G. Compliance | audit tecnico/registro per lead; WebResearcher compliance lane | SERP normative/municipal; OpenAPI solo P.IVA nota | nessun discovery cursor; applicability non risolta; evidence spesso norma, non gap aziendale | Italia, volume ignoto | RICERCA SERP GENERICA | Separare regulatory event da company applicability; adapter registri/certificazioni/scadenze. |
| H. Management change | `OpenAPISource` registry-change e `NewsAPISource` per lead noto | OpenAPI/NewsAPI company-first; SERP | no discovery pagination; person/role/effective date parziali | aziende gia' note | INTEGRAZIONE INCOMPLETA | Registry/event adapter discovery-first con company/person/role/effective date. |
| I. Nuovi prodotti/mercati | WebResearcher, company/news/social nominati | SERP, sito/news recuperati da URL; nessun social adapter dedicato | pagination SERP; launch date/entity via LLM | open web, non esaustivo | RICERCA SERP GENERICA | Company newsroom/product feed + industry news adapter e availability/date verifier. |
| J. Segnali arbitrari | `WebResearcher` + `DataExtractor` | Serper/Brave/DDG, Playwright, LLM extraction | query paging provider; no source-specific cursor/exhaustion; evidence generic | open web; volume non garantibile | FALLBACK GENERICO | `GenericWebAdapter` dichiarato partial, con coverage gap e nessuna promessa di completezza. |

## Registry dichiarato vs binding runtime

| Source registry id | Dichiarazione | Binding discovery v5 reale | Verdetto |
|---|---|---|---|
| `official_company_website` | HTTP/Playwright, publishable | WebResearcher puo' trovarlo/fetch; non esiste adapter dedicato | PARZIALE |
| `company_careers` | JSON-LD/page extract | careers generic via SERP; company-first website enrichment | PARZIALE |
| `official_registry` | structured connector | OpenAPI company-first; nessun discovery connector | SOLO PLANNER/PARZIALE |
| `public_procurement_portal` | structured connector | SERP nel v5; ANAC/TED enrichment separato | PARZIALE |
| `municipal_register` | document extract | solo query SERP/template | SOLO PLANNER |
| `job_board` | search/http | company-first scrapers; v5 SERP | PARZIALE |
| `ad_transparency_library` | structured/browser | lookup candidate-first/UI; non discovery | PARZIALE |
| `technology_audit` | Playwright direct observation | audit reale | IMPLEMENTATO |
| `recognized_local_news` | search/http | generic SERP o NewsAPI company-first | PARZIALE |
| `industry_publication` | search/http | generic SERP | SOLO PLANNER |
| `official_social_profile` | browser | social contact discovery/audit, non signal adapter | PARZIALE |
| `google_business_maps` | maps connector | worker legacy reale | IMPLEMENTATO per discovery categoriale |
| `directory` | discovery only | filtrata/blacklist; nessun adapter necessario | FALLBACK/BLOCKED |
| `generic_blog` | discovery only | SERP; non pubblicabile | FALLBACK |
| `search_snippet` | discovery only | provider SERP; non pubblicabile | IMPLEMENTATO come discovery-only |

## Capability gate richiesto

Il nuovo `AdapterCatalog` deve esporre per ogni id: implementation module, enabled/healthy, supported signals, supported geography, pagination, maximum freshness, cost estimator e capability version. `canonicalPlanToLegacy` non deve creare una lane finche' `AdapterCatalog.resolve(signal, geography)` non restituisce almeno un adapter eseguibile. In assenza, aggiunge `coverage_gap` e abilita `generic_web` soltanto come fallback parziale.

## Volume ed exhaustion

- 20 lead: un adapter verticale deve dimostrare almeno 20 candidate uniche, evidence date reale e qualified precision su fixture/replay.
- 100: cursor persistito, dedup cross-page e retry idempotente.
- 500: shard geography/signal, concurrency bounded, cost per qualified.
- 5.000: resume durable, exhaustion per shard, cache artifact/entity, backpressure e nessun LLM per record quando parser deterministico e' disponibile.

Nessun livello puo' essere dichiarato supportato se il volume deriva soltanto da aumentare il numero di query SERP.
