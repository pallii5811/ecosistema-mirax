# MIRAX Cursor Handoff

Base obbligatoria: `docs/MIRAX_CODEX_MASTER_DIRECTIVE.md`, `docs/MIRAX_SOURCE_ARCHITECTURE_AUDIT.md`, `docs/MIRAX_SOURCE_ADAPTER_MATRIX.md`. Branch iniziale `safety/mirax-v5-11-codex-checkpoint`; checkpoint `a6a1194724e25697d8ac1ca59a776a1423f7d73e`.

Non eseguire canary finche' Task 1-6 e i replay offline da 20 non sono verdi. Non modificare i gate per ottenere output.

## 1. Congelare il vecchio Digital Audit

- Obiettivo: impedire regressioni al motore Maps -> sito -> audit -> contatti.
- File da leggere/modificare: `backend_mirror/audit_engine.py`, `backend_mirror/adaptive_audit.py`, `backend_mirror/worker_supabase.py`; aggiungere `evaluation/fixtures/digital-audit-regression-v1.json` e `backend_mirror/test_digital_audit_regression.py`.
- Modifica: fixture provider-free con lead locali rappresentativi; nessun refactor del worker.
- Verifica: `python -m pytest backend_mirror/test_digital_audit_regression.py -q`.
- Atteso/DoD: dominio, contatti, social, tecnologie e rejection behavior invariati; zero network nei test.
- Rischio/dipendenza/costo: payload legacy eterogenei; costo runtime nuovo zero.

## 2. Introdurre i quattro contratti canonici

- Obiettivo: eliminare mapper impliciti tra planner, source, evidence e lifecycle.
- Creare: `backend_mirror/source_adapters/__init__.py`, `contracts.py`, `catalog.py`; `src/lib/source-adapters/contracts.ts` per mirror TS se necessario.
- Modificare: `contracts/source-registry.v1.json` aggiungendo `implementation_id` e `capability_version` soltanto per adapter reali; loader TS/Python deve validare il binding.
- Schemi: implementare esattamente `SourceAdapter`, `OpportunityCandidate`, `EvidenceRecord`, `QualifiedLead` definiti nell'audit. Pydantic/dataclass strict; niente `Dict[str, Any]` ai boundary pubblici.
- Test: `backend_mirror/test_source_adapter_contract.py`, `scripts/test-source-adapter-catalog.ts`.
- Verifica: `python -m pytest backend_mirror/test_source_adapter_contract.py -q` e `npx tsx scripts/test-source-adapter-catalog.ts`.
- DoD: source registry non puo' dichiarare executable un id senza factory; signal alias canonico prima dell'adapter; schema round-trip.
- Rischio/costo: doppio schema TS/Python; costo runtime zero.

## 3. Collegare il planner alle capability reali

- Obiettivo: vietare source lane decorative.
- Modificare: `src/lib/uqe/mirax-query-planner.ts` (`canonicalPlanToLegacy`, `defaultSourcePlan`, `sourcePlanForCommercialHypothesis`), `src/lib/intent-compiler/compile-commercial-search-plan.ts`, `backend_mirror/agents/web_researcher.py`.
- Modifica esatta: `AdapterCatalog.resolve(required_signal, geography)` produce `adapter_ids`; una lane senza adapter produce `coverage_gaps[]`; `generic_web` e' fallback esplicito `partial`, non sostituzione silenziosa.
- Correggere fallback offline: query A -> `contract_awarded/public_procurement`; B -> `active_advertising/ads`; C -> `hiring_operational/job_market`, Italia e PMI conservati.
- Test: estendere `scripts/test-commercial-query-matrix.ts`; aggiungere `scripts/test-adapter-routing-three-traces.ts` con le tre query dell'audit.
- Verifica: `npx tsx scripts/test-adapter-routing-three-traces.ts`.
- DoD: piano e runtime adapter coincidono; nessuna Maps per signal-led; nessun provider nel test.
- Rischio/costo: differenze canonical/legacy; costo runtime zero.

## 4. Procurement Adapter discovery-first

- Obiettivo: scoprire aggiudicatari da data/geografia/CPV senza conoscere prima l'azienda.
- Riutilizzare: `backend_mirror/anac_indexer.py`, `anac_client.py`, `waterfall_enrich.ANACSource/TEDSource`, entity matcher.
- Creare: `backend_mirror/source_adapters/procurement.py`; fixture `evaluation/fixtures/procurement-awards-v1.json`; `backend_mirror/test_procurement_adapter.py`.
- Modificare `anac_indexer.py`: API read-only `discover_awards(date_from,date_to,region,province,cpv,cursor,limit)`; normalizzare CIG, winner name/CF, authority, amount, award date, source URL. TED fallback con page/cursor e party-role validation.
- DB/migrazione: creare `db/migrations/2026_07_15_source_adapter_runs.sql` con `source_adapter_runs`, `source_adapter_artifacts`, cursor, counts, cost, exhaustion e unique idempotency key.
- Verifica: `python -m pytest backend_mirror/test_procurement_adapter.py -q`.
- DoD: replay query A produce 20 unique candidates con winner esplicito; issuer/participant non winner respinti; zero LLM; exhaustion deterministico.
- Rischio: dataset ANAC locale freshness/coverage, TED schema; costo stimato quasi zero oltre fetch/document parsing.

## 5. Hiring Adapter discovery-first

- Obiettivo: partire da ruolo/geografia, non da company name.
- Riutilizzare: `hiring_sources.py`, careers parser in `business_events_enrich.py`, `agents/hiring_evidence.py`.
- Creare: `backend_mirror/source_adapters/hiring.py`, `ats_parsers.py`; fixture `evaluation/fixtures/hiring-discovery-v1.json`; `backend_mirror/test_hiring_adapter.py`.
- Implementare: discovery job board/ATS consentiti con cursor; parser JSON-LD `JobPosting`; employer, role, location, posted/expiry date, canonical job URL; careers HTML solo se vacancy concreta. Google HTML resta fallback non authoritative.
- Modificare: wrapper `IndeedSource`, `InfojobsSource`, `WebsiteCareersSource` per delegare al nuovo parser; non duplicare regole.
- Verifica: `python -m pytest backend_mirror/test_hiring_adapter.py backend_mirror/test_hiring_canary_forensic_replay.py -q`.
- DoD: query C replay produce 20 candidate con vacancy operativa; careers root/navigation respinte; FMACH resta non-qualified senza PMI fit; cursor/exhaustion.
- Rischio: ToS/markup instabile/anonymous employer; preferire JSON-LD/ATS e source ufficiali. Costi: fetch; LLM solo eccezioni bounded.

## 6. Ads/Expansion Adapter

- Obiettivo: query B e segnali di sede/impianto con evidenza non inferita.
- Creare: `backend_mirror/source_adapters/ads.py`, `expansion.py`; fixture e test omonimi.
- Riutilizzare: Meta verification in `src/components/dashboard/hooks/useSignalIntentEnrich.ts`, `src/lib/signal-intent/marketing-investment.ts`; audit tecnico; generic web soltanto per discovery secondaria.
- Ads: se API consente discovery, cursor advertiser/geography; altrimenti `candidate-first verification` su universo PMI esplicitamente dichiarato. Verificare advertiser<->official domain/landing.
- Expansion: company newsroom, municipal/permit documents e local news; distinguere planned/started/completed e company/issuer.
- Test: zero pixel => non investing; agency ad mismatch => reject; announcement without company/date => reject; active advertiser/domain match => pass.
- Verifica: `python -m pytest backend_mirror/test_ads_adapter.py backend_mirror/test_expansion_adapter.py -q`.
- DoD: 20 per trace offline con source/date/entity; coverage dichiarata; no spesa inventata.
- Rischio/costo: accesso Ads e municipal fragmentation; hard cap per adapter e cache obbligatoria.

## 7. Orchestratore adapter-first

- Obiettivo: sostituire il passaggio lane->SERP con adapter->candidate, preservando generic web fallback.
- Creare: `backend_mirror/source_adapters/orchestrator.py`.
- Modificare: `agentic_gap_fill.run_agentic_discovery_streaming`, `worker_supabase.py`, `commercial_lifecycle.py` solo per consumare contratti, non per abbassare gate.
- Algoritmo: reserve -> adapter discover -> artifact persist -> entity resolve -> evidence extract -> audit -> lifecycle; dedup domain/VAT/entity; adapter exhaustion; resume cursor.
- GenericWebAdapter: wrapper di `WebResearcher/DataExtractor`, sempre `coverage=partial`, snippet non evidence.
- Test: `backend_mirror/test_adapter_orchestrator.py` con failure injection, retry idempotente, hard cap, resume e multi-adapter dedup.
- DoD: nessun provider call senza reservation; no duplicate charge/candidate; lifecycle riceve solo campi canonici.

## 8. Replay offline da 20

- Creare: `evaluation/fixtures/adapter-traces-v1/{procurement,hiring,ads-expansion}.json`; `scripts/replay-adapter-traces.mjs` o runner Python unico.
- Metriche: discovered, artifacts, unique entity, resolved, evidence verified, target fit, qualified, rejection codes, cost simulated, exhaustion.
- Gate: 20 qualified per trace; zero publisher/issuer/directory/global brand; 100% source URL/publisher/date/excerpt/domain; costo simulato entro budget dichiarato.
- Nessun canary. Se gate fallisce, correggere adapter/mapper e fixture negative; non lifecycle.

## 9. Scalare 100 -> 500 -> 5.000

- 100: stessa query, cursor resume, dedup cross-page, cost per qualified.
- 500: shard geografia/ruolo/CPV e concurrency bounded; backpressure DB.
- 5.000: durable queue, checkpoint per shard, artifact/entity cache, exhaustion report e no per-record LLM.
- Creare test scale sintetici provider-free (`test_adapter_scale.py`) con adapter fake deterministico, non 5.000 chiamate live.
- Definition of Done per livello: exact count soltanto se il source universe contiene abbastanza qualified; altrimenti stato partial con exhaustion provata.

## 10. Canary e release, soltanto dopo autorizzazione

- Preflight: tutti i replay, cost cap, worker safety, DB clean, zero stale reservation, no customer visibility.
- Un solo shadow canary da 20 sul vertical adapter completato; quarantena automatica se qualified<20 o precision gate fallisce.
- Non iniziare questo task automaticamente. Richiede autorizzazione utente esplicita dopo revisione dei replay offline.

## Strategia commit

Un commit atomico per task (`contracts`, `planner capability`, `procurement`, `hiring`, `ads-expansion`, `orchestrator`, `replay/scale`). Aggiornare `docs/MIRAX_MASTER_IMPLEMENTATION_STATE.md` sinteticamente dopo ogni gate. Non includere segreti, dump raw non sanitizzati o file temporanei.
