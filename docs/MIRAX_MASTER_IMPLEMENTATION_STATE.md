# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-13 15:45 (Europe/Rome)

## Checkpoint corrente — ispezione read-only + safety snapshot v5.11 — 2026-07-13 15:45 +02:00

### Release e runtime verificati live (read-only)

- **Frontend produzione attivo**: `https://ecosistema-mirax-two.vercel.app`
- **Release marker Vercel** (`GET /api/ops/release`): `2026-07-13-complete-signal-lane-coverage-v5-11`
- **Schema/prompt**: commercial plan `1.0.0`, intent `commercial-intent-v1.1.0`, source registry 15 classi, signal ontology 43 segnali
- **`MIRAX_SEARCH_DISABLED`**: `true` (marker `production_search_disabled=true`; env Vercel production presente)
- **Backend live** (`:8001/health`): frozen `20260712_201500_v4`
- **Backend staging** (`:8002/health`): frozen `20260713_124614`
- **Rollback staging**: `/home/worker/backups/staging-pre-20260713_124614`
- **Rollback live**: release `20260712_201500_v4` (backup `final-hardening-pre-20260712_*` presenti)
- **Symlink**: `/home/worker/app/backend` e `/home/worker/app/backend-staging` (directory release, non symlink esterni)
- **Hash staging ↔ workspace locale (coincidenti)**:
  - `worker_supabase.py`: `1ba5b941aaf23fd30c553e99a9c02fc51be315af72d6d2bd44a34f2c17cafba9`
  - `commercial_lifecycle.py`: `dd4e7787ecbbecc68860f0a56c3dc8b826e73d7a1a53c54df270a5f0d20b35cf`
- **Hash live (diverso da staging, atteso v4)**:
  - `worker_supabase.py`: `fd1a393c354fa029718f02f2db33f046d4a6770a1489301f3c50442d8588435f`
  - `commercial_lifecycle.py`: `a20e2f6016bf36b622498ed6ae47a4964e802e31b7741b7a87c84a9803f46702`

### Worker e processi

- **`mirax-worker` / `mirax-worker-staging` systemd**: `inactive` + `disabled` (verificato)
- **`mirax-audit-api` / `mirax-audit-api-staging`**: `active` + `running` (porte 8001/8002 — API audit, non polling worker)
- **Processi uvicorn**: 2 processi `worker_supabase:app` su 8001 e 8002 (audit API, non job backlog systemd)
- **Processi one-shot shadow**: 0
- **Env server (masked)**: `MIRAX_WORKER_DISABLED` e `ANTHROPIC_EXTRACT_ENABLED` presenti su live e staging; `MIRAX_SEARCH_DISABLED` non è flag backend (solo Vercel)

### Neo4j (read-only)

- Connesso: `connected=true`, `enabled=true`
- Grafo: **3.091 nodi**, **14.938 relazioni**, **14 tipi** di relazione

### Supabase — stato job/canary/costi (SELECT read-only)

| Metrica | Valore |
|---|---|
| Job `pending` | **1** |
| Job `running`/`processing`/`planning` | **0** |
| Canary `running` | **1** (`shadow_workplace_safety`) |
| Canary `quarantined` (recenti 13/07) | accountant, insurance_broker, local_web_agency×2, software_house, hr_recruitment, solar_energy, cybersecurity, erp_crm |
| Evaluation run `running` | **1** (workplace_safety) |
| Cost ledger `reserved` aperte | **0** |
| Cost ledger `settled` (totale storico) | 33 righe, **€1,153947** actual |
| `search_publications` | **0** |
| `search_credit_charges` | **0** righe |
| RLS lifecycle tables | **attiva** su candidates/evidence/cost/budget/publications |

### `workplace_safety` — stato esatto (interrotto, NON completato)

Codex si è interrotto **dopo prepare/compiler, prima del one-shot worker**.

| Entità | ID | Stato |
|---|---|---|
| Search | `6ecc8d72-db71-4b06-a215-9cc0fb92f303` | `pending`, results=[], worker_id=null |
| Canary | `8e0297c9-8724-45c0-8a9f-5de17ff48be8` | `running`, type=`shadow_workplace_safety` |
| Evaluation run | `0dd16cf5-f1a9-4e0f-a0f7-49f4a0240285` | `running`, mode=`shadow_research`, release=`v5-11` |

- **Prepare/compiler**: PASS — piano canonico LLM, `organic_web_search`, segnale `hiring_operational`, lane `job_market` (careers + job_board), PMI/Italia, budget hard €0,125
- **Costo sostenuto**: **€0,05** (`intent_compilation`, Anthropic, settled)
- **Budget state**: committed €0,05 / hard €0,125, status `active`
- **Fonti/candidati/pubblicazioni**: 0 query eseguite, 0 candidati, 0 pubblicazioni, 0 addebiti cliente
- **Nota semantica**: il piano ha solo `hiring_operational`; il manifest atteso include anche `contract_awarded` e `production_expansion` — da rivalutare offline prima di ripresa (non mutato in questa sessione)

### Workspace locale consolidato

- **Branch safety**: `safety/mirax-v5-11-codex-checkpoint`
- **Commit snapshot WIP**: `6f02830` — `WIP: MIRAX v5.11 Codex checkpoint before Cursor continuation`
- **Backup esterno**: `C:\Users\Simone\CascadeProjects\mirax-v5-11-codex-backup-20260713_154503\workspace.tar.gz` (~119 MB)
- **Segreti**: scan pre-commit OK — solo `.env*.example` modificati; nessun `.env` reale nel commit

### Test offline superati (post-checkpoint)

- `test:commercial-contract`: PASS (23/23 + normalization + security + pytest 9/9)
- `test-routing-guards.ts`: PASS (13/13)
- pytest cost/agentic/contract: PASS (47/47)
- `tsc --noEmit`: PASS
- high-value compiler matrix: PASS (10/10)
- commercial query matrix: PASS (137/137)
- shadow manifest signal floor: PASS (10/10)

### Anomalie rilevate (non risolte in questa sessione)

1. **`workplace_safety` orfano**: search `pending` + canary/eval `running` senza worker one-shot — richiede decisione controllata (quarantena o ripresa one-shot), **non** auto-fix
2. **`search_budget_state` attivi** su run quarantinati precedenti (erp, cyber, solar, hr) — non sono reservation stale ma budget row residue
3. **Doc precedente** fermato a v5.8 — ora allineato a v5.11
4. **Codice v5.11 nel commit locale** non ancora ridistribuito su Vercel/Hetzner oltre al marker frontend già live

### Prossimo comando sicuro

**NON** creare un nuovo run. Prima:

1. Decidere su `workplace_safety` orfano: quarantena transazionale read-then-write controllata **oppure** ripresa one-shot staging `20260713_124614` con worker esplicitamente autorizzato
2. Offline: `npm run test:commercial-contract && npx tsx scripts/test-routing-guards.ts && python -m pytest -q backend_mirror/test_cost_quality_guards.py`
3. Invarianti finché non autorizzato: `MIRAX_SEARCH_DISABLED=1`, worker generali inactive, nessuna customer publication

---

## Checkpoint corrente — HR quarantinato e convergenza v5.8 — 2026-07-13 09:03 +02:00

### ERP/CRM — source plan incompleto quarantinato

- Run `eb7f4cb4-d3b9-43f4-b0fe-42edb474e82d`, canary `ab6cdcf8-67ef-4490-8f08-de63f3cc19e8`, search `0a1ee150-2e18-42a9-93cd-2d3b729e1a43`.
- Segnali richiesti: `hiring`, `technology_migration`, `new_location`; il piano eseguibile copriva solo `hiring` e riduceva l'offerta esplicita `ERP e CRM` a `software CRM`.
- Run quarantinato prima delle fonti: compiler `€0,05`; repair/fonti/candidati/pubblicazioni/addebiti cliente 0.
- Correzione offline: l'offerta dopo `Vendo/Offro/Fornisco` ha precedenza sul catalogo; ogni segnale richiesto aggiunge almeno una source class compatibile; `technology_audit` supporta anche l'ID canonico `technology_migration`.
- Il prepare contiene ora il gate `source_plan_covers_all_signals`; test multi-segnale ERP verifica offerta completa e copertura eseguibile di ogni segnale.
- Fixture: `evaluation/fixtures/erp-incomplete-source-coverage-20260713.json`. ERP/CRM resta quarantinata.

### Cybersecurity — sparse compiler output quarantinato

- Run `6d5cafab-12a4-4fa8-825e-780c7c00bbf9`, canary `47e0dfb1-d391-4cd4-9b10-d61f9e040b2f`, search `3d633183-7403-43b6-b2b6-f1d9527b34dc`.
- Il provider ha restituito `commercial_hypotheses=[]`; il contratto ha fallito chiuso prima delle fonti. Costo compiler `€0,05`; fonti/candidati/pubblicazioni/addebiti cliente 0.
- Root cause: la forma esplicita `Vendo <offerta>:` non alimentava sempre l'inferenza seller deterministica quando il catalogo non conosceva l'offerta.
- Correzione offline: estrazione limitata alla clausola seller dopo `Vendo/Offro/Fornisco`, causal completion esclusivamente da segnale ontologico e offerta esplicita, senza repair pagato.
- Correzione aggiuntiva: ogni source lane riceve ora soltanto i segnali realmente supportati dalle sue source class; il prepare rifiuta lane con evidenza incompatibile.
- Fixture: `evaluation/fixtures/cybersecurity-sparse-plan-failure-20260713.json`. Cybersecurity resta quarantinata e non viene ritentata.

### Solar energy — prepare quarantinato prima delle fonti

- Run `c13be85f-3cc6-479d-a09e-f35170a46a35`, canary `8ce36925-404a-473d-917e-d23f452eee6c`, search `e86abe46-b34e-4880-adba-89e39ca7c08d`.
- Seller, buyer PMI, geografia Italia, segnale `production_expansion`, freshness 365 giorni, no Maps e cap `€0,125` erano corretti.
- Gate manuale fail-closed: `municipal_register` era stato convertito nella lane `public_procurement` con template `appalto/gara aggiudicata`, semanticamente incompatibile.
- Costo compiler `€0,05`; repair 0; fonti 0; candidati 0; pubblicazioni/addebiti cliente 0. Verticale quarantinata e nessun retry.
- Root cause corretta offline: municipal register usa ora la lane regolatoria/autorizzativa; i template di espansione produttiva devono contenere impianto, stabilimento, ampliamento o capacità e non possono contenere gare/appalti.
- Fixture: `evaluation/fixtures/solar-source-lane-failure-20260713.json`; test avversariale inserito nella matrice high-value.

### HR recruitment: esecuzione e riconciliazione

- Run `193c4bb0-9d66-4d83-b4dd-a3ed0ac1ca68`, canary `90ea2751-c600-4a86-be66-69d508e85fe0`, search `7d1798e2-f887-470a-80a8-b933a6f2aca1`.
- Il prepare ha superato il compiler con `hiring`, sorgenti `company_careers` e `job_board`, vincolo PMI, Italia, no Maps, freshness 60 giorni e budget hard `€0,125`.
- Il one-shot staging ha aperto 15 pagine, eseguito 2 estrazioni Anthropic, prodotto 1 raw candidate senza dominio ufficiale e 0 candidati qualified. Il finalizer ha fallito chiuso e quarantinato la verticale.
- Costo totale riconciliato `€0,106891`: compiler `0,05`; search job `0,01`; web search `0,02`; pagine `0,003`; estrazioni `0,018891`; Serper `0,005`.
- Pubblicazioni cliente, addebiti cliente e worker generali riattivati: 0. Fixture: `evaluation/fixtures/hr-source-execution-failure-20260713.json`.

### Correzione dimostrata offline

- Ogni lane canonica ora deve avere query template non vuoti; il prepare lo verifica prima di qualsiasi fonte.
- Hiring generico usa prima careers ufficiali PMI e poi job board; non assume più developer. Pagine category/search e blog/tag vengono eliminate prima dell'LLM.
- Il buyer scope è separato dal testo del venditore: il prodotto del seller non può contaminare i segnali del compratore.
- Aggiunti i segnali contestuali e i relativi prefiltri/query-source: `production_expansion`, `new_location`, `cybersecurity_exposure`, `regulatory_change`, `technology_migration`, `manual_processes`.

### Release e stato sicuro

- Frontend produzione: `2026-07-13-source-execution-seller-scope-v5-8`; `MIRAX_SEARCH_DISABLED=1` verificato.
- Backend staging immutabile: `20260713_085148`, porta 8002 OK, servizio inactive+disabled. Backend live 8001 non modificato.
- Preflight completo PASS: contract 23/23; query matrix 137/137; high-value 10/10; signal floor 10/10; query reali 55/55; backend 47/47.
- Active job/canary/stale reservation: 0/0/0. Gold v5: 0; giudizi v5: 0; legacy human baseline: 7.

### Prossimo comando sicuro

Una sola chiamata `prepare` per `solar_energy`, verticale nuova e non quarantinata, senza repair. Un solo one-shot staging è ammesso soltanto se il piano supera tutti i gate. Cap complessivo `€0,125`; nessuna pubblicazione cliente.

## Regola di stato

Questo documento riporta solo evidenze riprodotte sul repository e sui runtime correnti. La ricerca di produzione resta disabilitata finché l'intera matrice di acceptance e i canary multi-verticali non passano. Nessuna chiave o segreto deve essere registrato qui.

## Baseline forense verificata

- Branch locale: `universal-engine`.
- Ultimo commit osservato: `353810f chore: default agentic OpenAI model to gpt-5.5`.
- Working tree: ampiamente modificato e non consolidato; sono presenti modifiche precedenti dell'utente e nuove modifiche non tracciate. Non eseguire reset o checkout distruttivi.
- Frontend di produzione verificato: `https://ecosistema-mirax-two.vercel.app` risponde HTTP 200.
- Brake Vercel verificato: `MIRAX_SEARCH_DISABLED=1`.
- Worker Hetzner verificati: 6/6 servizi MIRAX `inactive` e `disabled`.
- Estrazione Anthropic worker: `ANTHROPIC_EXTRACT_ENABLED=0`.
- Limiti worker correnti: massimo 3 richieste LLM e 0,03 USD per job.
- Codice `web_researcher.py`: hash SHA-256 locale, produzione e staging coincidente (`0b0075…c7`).
- Neo4j: abilitato e raggiungibile; 3.091 nodi, 14.938 relazioni, 14 tipi di relazione al controllo read-only. Questi numeri provano salute e popolamento, non ancora precisione commerciale.
- Database `searches`: prima della bonifica erano presenti 54 job completed, 8 cancelled, 4 error e 1 job stale `running`.
- Job stale `743cbded-d4eb-4c93-889a-cb0a9ceae9ac`: fermo dal 7 luglio con 89 risultati intermedi; quarantinato transazionalmente il 2026-07-11 (`status=cancelled`, `results=[]`, `stop_reason=safety_quarantine_stale_job`).
- Payload attivi con risultati intermedi dopo la bonifica: 0.
- Nessuna tabella dedicata a plan/evidence/cost/candidate era presente nella baseline osservata.
- La tabella di tracking delle migration applicative non è presente nello schema pubblico; l'elenco locale delle migration non equivale quindi a prova di applicazione remota.

## Test riprodotti

- `npm run preflight:canary`: PASS.
- Parser query reali: 55/55 check, 0 fail.
- Routing guards: 13/13 PASS.
- Backend quality/cost guards: 18/18 PASS.
- Contratto TypeScript: 5/5 PASS.
- Contratto Python e boundary worker: 7/7 PASS.
- `npx tsc --noEmit`: PASS.
- App health, production brake, data hygiene e stato servizi: PASS nella preflight.

Questi test non dimostrano ancora precisione live >=90%, contact coverage >=90% o costo <=0,025 EUR per lead pubblicato.

## Architettura verificata prima del Master Plan

La pipeline esistente comprende planner TypeScript, fallback euristici/playbook, WebResearcher Python, estrazione e audit Playwright, filtri enterprise/source, pubblicazione su `searches.results`, dual-write normalizzato e mirror Neo4j. Erano già presenti lease worker, limiti LLM, filtri sui segnali richiesti e blocco dei brand globali.

Gap strutturali confermati:

1. assenza di un contratto canonico condiviso e versionato;
2. strutture TypeScript/Python indipendenti;
3. playbook deterministici capaci di sovrascrivere il piano LLM;
4. nessun lifecycle database esplicito candidato -> verificato -> pubblicato;
5. ledger costi non centralizzato;
6. source registry e ontologia segnali non ancora canonici;
7. sincronizzazione grafo invocabile durante publish progressivo;
8. assenza di metriche live sufficienti per dichiarare 10/10.

## Fase 1 — contratto canonico (implementata localmente, non ancora rilasciata)

Introdotti:

- `contracts/commercial-search-plan.schema.json`: JSON Schema canonico v1.0.0.
- `src/lib/contracts/commercial-search-plan.ts`: validazione Zod fail-closed e tipo TypeScript derivato.
- `backend_mirror/contracts/commercial_search_plan.py`: modelli Pydantic strict.
- fixture cross-runtime condivisa.
- test di drift, budget, pesi, range, campi extra e boundary worker.
- validazione Pydantic nel worker prima del claim e prima di qualunque spesa, quando il payload dichiara `canonical_plan`.

## Fase 2 — intent compiler universale (implementata localmente, validazione live pendente)

Introdotto un compilatore Anthropic strutturato che:

- usa il contratto canonico come tool schema;
- tratta l'LLM come motore semantico primario;
- conserva playbook/regex solo come fallback offline;
- applica un solo repair call bounded;
- rileva inversione seller/buyer, segnali orfani, freshness mancante, source policy vuota e incoerenza SME;
- forza official domain, source URL e observation date;
- forza il budget a 0,021 EUR target e 0,025 EUR hard cap per lead richiesto;
- esclude snippet, directory e blog generici come prova;
- passa il canonical plan al worker dentro `uqe_plan`.

Il provider resta disabilitato in produzione. Non sono stati effettuati test Anthropic a pagamento in questa fase.

## Stato fasi

- Fase 0 baseline forense: completata per repository, Vercel, Hetzner, job e connettività Neo4j. Audit migration applicate e qualità semantica del grafo ancora parziali.
- Fase 1 contratto canonico: implementata, testata e distribuita con worker spenti.
- Fase 2 intent compiler: implementata e distribuita; replay/canary Anthropic pendenti.
- Fase 3 source registry: registry v1 implementato e validato in entrambi i runtime. Ontologia segnali completa ancora da implementare.
- Fase 4 orchestratore agentico budgeted: parziale nel codice preesistente, da riallineare al contratto.
- Fase 5 lifecycle candidati/entity resolution: schema candidato/evidenza/pubblicazione applicato; integrazione completa del worker pendente.
- Fase 6 worker audit adattivo: parziale, da tipizzare e collegare all'evidence contract.
- Fase 7 evidence graph/scoring: parziale; precisione non ancora misurata.
- Fase 8 cost governor centrale: ledger SQL e governor deterministico TypeScript implementati; integrazione di ogni operazione esterna pendente.
- Fasi 9-12 feedback, UI, evaluation, canary e rollout: pendenti.

## Rischi aperti

- Nessun deploy deve riattivare automaticamente i worker.
- Nessun canary a pagamento deve partire senza budget esplicito e brake dedicato.
- Le modifiche non consolidate nel working tree richiedono diff review prima di commit/deploy.
- La salute di Neo4j non prova che tutte le relazioni abbiano evidenza o valore commerciale.
- I test euristici esistenti sono troppo concentrati sul routing; serve la matrice multi-verticale del Master Plan.
- Il costo target deve essere misurato su lead pubblicati, non stimato soltanto su token.

## Comandi sicuri per riprendere

```powershell
npm run test:commercial-contract
npx tsc --noEmit
npx tsx scripts/test-routing-guards.ts
python -m pytest -q backend_mirror/test_cost_quality_guards.py
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run preflight:canary
```

Controllo Neo4j read-only sul server:

```bash
cd /home/worker/app/backend
/home/worker/app/venv/bin/python scripts/check_neo4j_health.py
```

## Criterio di uscita

Non dichiarare MIRAX production-ready o 10/10 finché precisione, evidence coverage, official-domain coverage, contact coverage, cost per published lead, idempotenza, rollback e canary multi-verticali non superano i valori del Master Implementation Plan.

## Checkpoint runtime e release — 2026-07-12

Stato: **verificato, testato e distribuito con ricerca globale disabilitata**.

- Deployment Vercel verificato `Ready`: `dpl_Vog9VQ8KmaNyHSVtPZ36QfKGKmjK`.
- Alias verificato: `https://ecosistema-mirax-two.vercel.app`.
- Marker runtime pubblico verificato: release `2026-07-12-final-hardening-v1`, contract schema `1.0.0`, source registry 15 classi, signal ontology 43 segnali.
- Il marker e l'environment Vercel confermano `production_search_disabled=true` / `MIRAX_SEARCH_DISABLED=1`.
- Sei servizi worker Hetzner: 6/6 `inactive` e 6/6 `disabled`.
- Database: nessun job attivo e nessun payload attivo contenente risultati; lifecycle tables presenti, RLS attiva e RPC di pubblicazione riservata a `service_role`.
- Codice backend locale/produzione/staging allineato per worker, lifecycle, governor, discovery, structured lanes, planner, source registry e signal ontology; compilazione Python remota riuscita.
- Preflight estesa post-deploy: TypeScript PASS; marker 2/2; plan/source/ontology 9/9; lifecycle 12/12; cost governor TypeScript 6/6; matrice 15 verticali 137/137; UI/visibility/enterprise guards PASS; routing 13/13; parser 55/55; backend quality 19/19; contract boundary 9/9; lifecycle/governor 8/8; app health e brake PASS.

Misure ancora aperte: precisione live, top-tier precision, copertura evidenze/date/domini/fonti, copertura contatti pubblicamente disponibili e costo reale per lead pubblicato. Il superamento dei test offline non sostituisce queste misure.

## Aggiornamento fase source/lifecycle — 2026-07-11

- Source registry v1: 15 classi tipizzate con trust, costo, access method, freshness, falsi positivi, corroborazione e capacità di pubblicazione.
- Le source class inventate dall'LLM vengono rifiutate sia dal compiler TypeScript sia dal boundary Python.
- Neo4j nel percorso principale viene sincronizzato solo dopo stato `completed`; Postgres viene aggiornato prima dei sidecar normalizzato/grafo.
- Migration `2026_07_11_commercial_research_lifecycle.sql` testata con transazione+rollback sul database reale e poi applicata.
- Tabelle create e verificate: `search_candidates`, `search_evidence`, `search_cost_ledger`, `search_publications`.
- RLS attiva su tutte le nuove tabelle; candidati, evidenze e costi non sono leggibili da anon/authenticated; le pubblicazioni sono leggibili solo dal proprietario.
- RPC `publish_search_candidate` revocata ad anon/authenticated e concessa solo a `service_role`; rifiuta candidati senza tutti i gate o senza evidenza pubblicabile.
- Deploy backend completato su produzione e staging con backup timestamped; tutti i worker sono rimasti inattivi.
- Deploy Vercel completato: release `ecosistema-mirax-ctwaujqdm-simodepertis-projects.vercel.app`, alias di produzione aggiornato.
- Preflight post-deploy completa: PASS, inclusi contract 6/6, lifecycle 12/12, backend contract 8/8, backend guardrail 19/19, routing 13/13, parser 55/55.
- Cost governor deterministico: reservation idempotente, settle/release, economy threshold e hard stop; test 6/6. Non è ancora collegato a ogni tool Python, quindi il gate economico end-to-end resta aperto.

## Checkpoint CTO final hardening v2 — 2026-07-12

### Verified

- Frontend production alias: `https://ecosistema-mirax-two.vercel.app`.
- Deployment Vercel attivo: `dpl_DoUuAeGPAYM3TC8yEq96wJJDtbeJ`, URL `ecosistema-mirax-2a1kvs116-simodepertis-projects.vercel.app`, stato `Ready`.
- Marker runtime: `2026-07-12-final-hardening-v2`; HTTP 200; `production_search_disabled=true`.
- Configurazione progetto Vercel corretta da Node `24.x` non supportato a Node `22.x`.
- Backend live e staging: frozen release `20260712_153412`; backup rollback `/home/worker/backups/final-hardening-pre-20260712_153412`.
- Hash SHA-256 locale/live/staging coincidenti per worker, commercial lifecycle, cost governor, SSRF guard, adaptive audit, agentic discovery e SERP.
- Dieci unità worker controllate: tutte `inactive` e `disabled`; nessun processo `worker_supabase.py` orfano.
- Database: 0 job attivi, 0 payload intermedi attivi, 0 reservation costi stale, 0 saldi negativi, 0 charge duplicati, 0 canary attivi.
- RLS attiva su lifecycle, budget, credit, evaluation e canary tables; publish e reserve RPC negate ad anon/authenticated e concesse a service role.
- Gold evaluation: 200 slot su 10 verticali; giudizi umani completati 0/200.
- Neo4j read-only health: connesso, 3.091 nodi, 14.938 relazioni, 14 tipi.

### Implemented

- Governor costi atomico persistente con lock database, reservation idempotente, settlement/release, hard stop preventivo, retry metadata e recovery conservativo delle reservation stale.
- Planning job non reclamabile dal worker prima del completamento del piano; Anthropic planning/repair fail-closed senza governor.
- Contratto evidenze con claim, fact category, publisher, date, retrieval method, content hash, provenance, contradiction metadata e stati `single_source`, `primary_source_verified`, `corroborated`.
- Classificazione positiva entity/domain con probabilità azienda operativa, confidence dominio, size class, presenza locale e flag media/directory/università/ente/publisher/global brand.
- SSRF guard su URL, DNS, redirect e Playwright; audit adattivo con cache indipendente per dominio/modulo/freshness.
- Credit ledger idempotente: addebito solo per pubblicazioni evidence-gated e refund idempotente.
- Evaluation/canary schema isolato dai risultati cliente; 200 slot human-reviewable.
- Deploy backend immutabile con rollback automatico e worker mantenuti spenti.

### Tested

- `npm run preflight:canary`: PASS sulla release v2.
- TypeScript: PASS.
- Contract/source/ontology: 9/9 PASS.
- Lifecycle schema: 12/12 PASS.
- Cost governor TypeScript: 6/6 PASS.
- Matrice commerciale: 137/137 su 15 seller category.
- Routing: 13/13; parser query reali: 55/55.
- Backend quality: 19/19; Python contract: 9/9; lifecycle/governor: 13/13.
- Runtime focal suite: 41/41; SSRF/failure/lease suite: 21/21.
- DB transaction+rollback: cost governor, evidence/entity, publication credits ed evaluation framework PASS.
- Concorrenza reale DB: 2 reservation simultanee, 1 accettata, 1 bloccata, overspend 0.

### Deployed

- Migration applicate: atomic cost governor, evidence/entity contract, publication credit ledger, evaluation/canary framework.
- Backend v2 distribuito su live e staging senza attivare worker.
- Frontend v2 distribuito e verificato sull'alias produzione.
- Duplicate deployment Vercel rimasto `Building` rimosso; nessun deployment orfano destinato a promozione tardiva.

### Measured

- Offline query routing: 137/137.
- User-visible active intermediate leads: 0.
- Stale cost reservations: 0.
- Concurrent budget overspend nel test: 0.
- Duplicate credit charges attuali: 0; negative balances: 0.
- Live precision/contact/cost: non ancora misurabili; nessun canary research v2 eseguito e 0/200 giudizi umani.

### Still open

- Intent compiler canary con LLM reale e misure costo/schema/inversione.
- Shadow research, domain/Playwright, transactional publication e multi-vertical canary.
- 200 giudizi umani; precision e Wilson CI per vertical/source/signal.
- Contact coverage con denominatore `publicly available` documentato.
- Cold/warm all-in marginal cost per published lead.
- Soak staging con fault injection completa e rollback rehearsal.
- UI interna di review e verifica desktop/mobile evidence-first.
- Observability/report operativi e release manifest finale.

### Exact safe resume

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run preflight:canary
node scripts/verify-final-runtime-state.mjs
npm run test:final-failure-injection
```

Il brake globale e i worker generali devono restare disabilitati. La frase finale resta vietata finché tutti i gate live e 200/200 giudizi umani non passano.

## Checkpoint CTO final hardening v3 — 2026-07-12

### Verificato

- Alias produzione Vercel: `https://ecosistema-mirax-two.vercel.app`; marker pubblico `2026-07-12-final-hardening-v3`; `production_search_disabled=true`.
- Backend live e staging: frozen release `20260712_190500_v3`; rollback backup `/home/worker/backups/final-hardening-pre-20260712_190500_v3`.
- Audit API staging `active`; worker di ricerca generali `inactive` e `disabled`; estrazione Anthropic server `0`.
- Runtime DB: 0 job attivi, 0 payload attivi, 0 reservation stale, 0 saldi negativi, 0 charge duplicati, 0 canary attivi.
- Neo4j: connesso, 3.091 nodi, 14.938 relazioni, 14 tipi di relazione.

### Modifiche v3

- Tutte le operazioni marginali Python note adottano il contratto `estimate -> reserve -> execute -> settle/release`: query LLM, extraction LLM, SERP supplementare, structured lane, web search e crawl.
- Il vecchio addebito postumo `llm-page` è stato rimosso; un errore di settlement ferma ulteriori operazioni a pagamento.
- Le chiavi già chiuse non rieseguono il provider; i retry concorrenti non possono trattare una chiamata già regolata come gratuita.
- Gli errori provider dopo l'avvio vengono regolati conservativamente alla reservation, non cancellati come costo zero.
- Rimossi i bypass LLM senza search lifecycle nei parser grafo/legacy.
- Ritirato l'arricchimento Claude UI-side non governato: route compatibile risponde `410`; nessun componente client la invoca.
- Aggiunto guard statico CI per autorizzare solo i tre endpoint Anthropic governati e vietare endpoint OpenAI o invocazioni del batch ritirato.

### Test eseguiti

- TypeScript: PASS; Next.js production build: PASS, 125 pagine generate.
- Runtime commercial suite aggiornata: 44/44 PASS, inclusi reserve-before-provider, fail-closed senza governor e deduplicazione provider.
- Failure/security/lease: 21/21 PASS; concurrency DB: 1 reservation accettata, 1 bloccata, overspend 0.
- Contract/source/ontology: 9/9; lifecycle: 12/12; cost TS: 6/6; matrice: 137/137; routing: 13/13; parser: 55/55.
- Preflight esteso post-deploy v3: PASS su runtime reale, Vercel, DB e server.
- Nessun canary a pagamento eseguito durante questo checkpoint.

### Gate ancora aperti

- Gold dataset: 200 slot, ma candidati controllati e giudizi umani ancora 0/200.
- Intent, shadow research/audit, transactional publication e multi-vertical canary non ancora eseguiti.
- Precision, Wilson CI, evidence/domain/source/date coverage, contact coverage e cold/warm cost non ancora misurati.
- Soak test prolungato, rollback rehearsal distruttivo-controllato e UX evidence-first desktop/mobile restano da certificare.

### Exact next safe commands

```powershell
node scripts/verify-final-runtime-state.mjs
npm run test:final-failure-injection
# Non avviare canary finché il relativo record isolato, il budget e il singolo worker non sono verificati.
```

Il sistema resta deliberatamente chiuso al traffico di ricerca cliente. Non dichiarare production-ready o 10/10 prima dei gate misurati del Master Plan.

## Checkpoint compiler canary e release v4 — 2026-07-12

### Verificato

- Release frontend `2026-07-12-final-hardening-v4` attiva sull'alias produzione; brake `true`.
- Backend frozen release `20260712_201500_v4` su live/staging; audit API sana; worker inattivi/disabilitati.
- Preflight estesa v4: PASS sul runtime reale.

### Canary intent eseguiti

1. Canary `150444c0-a209-494b-843b-238a54e5319f`, run `e6c09b71-021c-4b41-acf5-ac8496f03270`: quarantined. HTTP provider 404 causato da terminatori nel model env; costo conservativo €0,05; 0 lead/pubblicazioni.
2. Canary `77de1c20-b2f9-40d9-ba3e-6264158313bd`, run `c454d31c-40c0-4b5b-9fec-a8c1b0235cf5`: quarantined. Provider raggiunto, piano initial+repair non valido; costo €0,10; hard cap €0,125 rispettato; 0 lead/pubblicazioni.

Nessun terzo canary a pagamento è autorizzato finché la correzione non è dimostrata offline.

### Correzione v4

- Normalizzazione di model/key per rimuovere terminatori reali o escaped.
- Pruning ricorsivo degli extra field rispetto al JSON Schema canonico.
- Canonizzazione alias segnali, rimozione segnali/fonti inventate, source expansion compatibile, freshness obbligatoria, required signal nelle hypotheses, size PMI e ranking weights normalizzati.
- Diagnostica strutturata initial/repair registrabile dal canary runner.
- Test provider-response simulata e rumorosa: 12/12 PASS, piano canonico valido con una chiamata e nessun repair.

### FAILED GATES correnti

- Intent canary live valido: 0/2; richiesto almeno un canary corretto prima degli altri stage.
- Human judgments: 0/200; richiesto 200/200.
- Multi-vertical canary: non completato.
- Precision/cost/coverage live: non misurati.

### Exact next safe step

Mantenere brake e worker spenti. Popolare casi controllati/review umana; solo successivamente eseguire un nuovo intent canary v4 con budget massimo €0,125 e diagnostica abilitata. Non lanciare shadow research o customer traffic prima del superamento.

## Checkpoint gold dataset, human review e soak — release frontend v5

### Verificato

- Frontend runtime `2026-07-12-final-hardening-v5`; `MIRAX_SEARCH_DISABLED=1`.
- Backend resta frozen release `20260712_201500_v4`; tutti i worker inattivi e disabilitati.
- Review API anonima: HTTP 401; reviewer allowlist configurata per l'account interno verificato.
- Preflight v5 reale: PASS, incluso dataset safety e paid-operation scan.

### Gold dataset

- Pool storico indipendente dal compiler v4: 2.783 righe da search completate, 2.383 con sito, 2.588 con contatto, 781 con business signals.
- Grafo disponibile per supporto: 3.002 entità, 57.457 osservazioni, 2.322 canonical domain.
- 200/200 evaluation case popolati su 10 verticali; 200 domini unici; provenance completa.
- Campionamento: 10 potential-fit + 10 control per verticale. Il bucket è solo sampling e contiene `selection_is_not_ground_truth=true`.
- Expected labels create automaticamente: 0. Human judgments create automaticamente: 0.

### Human review

- Workbench distribuito: `https://ecosistema-mirax-two.vercel.app/dashboard/evaluation`.
- API: `/api/admin/evaluation-review`, service-role solo dopo auth + allowlist fail-closed.
- Ogni giudizio richiede label, buyer fit, dominio, entity class, evidence support, freshness, contatto, top-tier, motivazione, source URL HTTPS, signal date e certificazione umana.
- Reporter Wilson: `node scripts/report-gold-evaluation.mjs`; con campione incompleto non produce percentuali fittizie.
- Stato misurato: 0/200 giudizi; report acceptance `false`.

### Safety soak

- Report: `reports/final-safety-soak-v5.json`.
- 17/17 check PASS in 393.404 ms: suite failure/static guard e 5 iterazioni di atomic cost, concurrent reservation e publication credit ledger.
- Nessun provider, worker o customer publication; tutte le verifiche DB mutative eseguite in transaction rollback.
- Verifica post-soak: 0 job attivi, 0 reservation stale, 0 negative balance, 0 duplicate charge.

### Multi-vertical canary manifest

- `evaluation/canary-v1/manifest.json`: 10/10 verticali, shadow-only, customer-visible false, worker limit 1, stop-on-first-failure.
- Cap per canary: 5 lead / €0,125; massimo teorico suite €1,250. Il manifest è validato ma non è stato eseguito.

### FAILED GATE e ripresa sicura

- Human judgments: 0/200, richiesto 200/200. È un'azione umana reale e non può essere sintetizzata dal sistema.
- Aprire `/dashboard/evaluation` con l'account reviewer e completare i casi.
- Controllare il progresso con `node scripts/report-gold-evaluation.mjs --allow-incomplete`.
- Non eseguire altri canary a pagamento, non avviare worker e non rimuovere il brake finché il ground truth non è completo e validato.

### Rollback rehearsal verificato

- Primo tentativo con fixture su `main.py`: non valido perché systemd usa `worker_supabase:app`; l'attivazione di prova è stata immediatamente ripristinata manualmente a v4 e verificata.
- Secondo tentativo corretto `20260712_rollback_rehearsal_v5b`: import/compile PASS, swap eseguito, startup ASGI intenzionalmente fallito, activator exit 3, rollback automatico attivato.
- Post-rollback: backend e staging `20260712_201500_v4`, audit API healthy, 0 processi worker, 0 chiamate provider.
- Evidenza: `reports/rollback-rehearsal-v5.json`. Gate rollback tecnico: PASS.

## Checkpoint final deliverables v5

- Release manifest: `reports/release-manifest-v5.json`, marker runtime verificato, 14 source hash critici e 46 migration repository hashate.
- Production dossier: `docs/release-v5/PRODUCTION_RELEASE_DOSSIER.md`.
- Incident/kill switch: `docs/release-v5/INCIDENT_KILL_SWITCH_RUNBOOK.md`.
- Rollback runbook: `docs/release-v5/ROLLBACK_RUNBOOK.md`.
- Controlled launch checklist: `docs/release-v5/CUSTOMER_LAUNCH_CHECKLIST.md`.
- Validator dossier: 19/19 deliverable section presenti; pending gate esplicitamente non accettati.
- Prompt/model report, deployment, migration, test, failure, soak, credit reconciliation, security e limitation sono documentati con riferimenti alle evidenze.
- Canary/human/precision/coverage/cost report restano intenzionalmente incompleti, non simulati.

### Exact safe resume

1. Accedere con l'account reviewer a `https://ecosistema-mirax-two.vercel.app/dashboard/evaluation`.
2. Completare giudizi umani verificando personalmente fonte, dominio e data.
3. Eseguire `node scripts/report-gold-evaluation.mjs --allow-incomplete` per il progresso; senza flag deve uscire non-zero finché non sono 200.
4. Solo a 200/200 eseguire un singolo intent canary v5 con cap €0,125 e diagnostica.
5. Se passa, procedere col manifest `evaluation/canary-v1/manifest.json`, stop-on-first-failure.

Invarianti durante la review: `MIRAX_SEARCH_DISABLED=1`, worker inactive+disabled, `ANTHROPIC_EXTRACT_ENABLED=0`.

## Blocked checkpoint — human ground truth non ancora eseguito

Verifica ripetuta al terzo ciclo di continuazione:

- human judgments: 0/200;
- expected labels: 0/200;
- candidate cases: 200/200 con 200 domini unici;
- active canaries: 0;
- active jobs: 0;
- stale reservations: 0;
- duplicate charges: 0;
- brake e worker invariati.

Il lavoro non può proseguire correttamente verso precision/canary acceptance finché una persona non completa la review. Generare automaticamente le etichette, usare Sonnet come giudice o inferirle dai bucket di sampling violerebbe la policy del gold dataset e renderebbe invalide precisione e Wilson CI.

### Azione esterna richiesta

Accedere a `https://ecosistema-mirax-two.vercel.app/dashboard/evaluation` con `critomane@gmail.com` e completare i 200 casi. Dopo almeno un giudizio il goal può essere ripreso; a 200/200 partiranno report definitivo, intent canary v5 e suite multi-verticale.

## Correzione protocollo valutazione v5 — 2026-07-13

Questa sezione sostituisce esplicitamente il precedente requisito di 200/200 casi legacy prima dei canary.

### Legacy baseline

- Dataset: `mirax-gold-v1`.
- Uso consentito: calibrazione iniziale e regressione; non certifica la precisione v5.
- Target iniziale sufficiente: 20–30 giudizi; cap nel gold finale: 30.
- Stato reale: 7 giudizi umani completati, tutti nel verticale `accountant`.
- Baseline preliminare, non rappresentativa: buyer fit 5/7; dominio ufficiale 7/7; entity class 6/7; signal/evidence validity 2/7; freshness 3/7; contact extraction 7/7; top-tier 0/7.
- Le metriche includono Wilson 95% e sono etichettate `LEGACY BASELINE — not v5 precision` dal reporter.

### v5 evaluation dataset

- Dataset primario: `mirax-gold-v5`; manifest `evaluation/gold-v5/manifest.json`.
- Composizione target finale: 160 casi v5, 25 legacy baseline, 15 negativi/adversariali (vincoli ammessi: 150–170 / 20–30 / 10–20).
- Casi nuovi v5 presenti: 0.
- Casi legacy conteggiabili: 7 giudicati; 200 disponibili, ma al massimo 30 possono entrare nel finale.
- Casi adversariali presenti: 0.
- Precisione v5: non calcolabile e non riportata; il reporter vieta la fusione silenziosa con la baseline legacy.
- Reviewer aggiornato per dare priorità progressiva a `v5_output` e `adversarial`; in assenza di nuovi output propone legacy solo fino al cap.

### Telemetria multi-source

- Migration applicata: `2026_07_13_v5_evaluation_dataset.sql`.
- Nuova tabella evaluation-only `evaluation_source_events`, RLS fail-closed e accesso service-role.
- Eventi obbligatori: source selected, queried, candidate produced, signal confirmed, candidate rejected, candidate publishable in shadow.
- Campi obbligatori: source ID, URL, publisher, observation date, extraction method, cost, selection reason, candidate reference e signal type.
- Reporter: `npm run evaluation:sources`; aggrega fonti scelte/interrogate, candidati, conferme, scarti, costo per fonte, costo per candidato e costo per lead shadow-publishable.

### Stato intent canary v5

1. Run `198211f3-7195-4ac8-9806-96fa1a3e1145`, canary `32a70d31-0ca8-481b-9d98-cea6db373885`: quarantined. Payload initial+repair incompleti, fallback euristico, costo conservativo €0,10, zero lead/pubblicazioni.
2. Run `ebf61d2e-ca6a-4109-9d75-148e6447468d`, canary `2f2fd4ea-7c4d-4c1c-86ce-a44dd05418ba`: quarantined per override semantico. Schema formalmente valido ma segnale hiring perso e routing Maps errato; costo conservativo €0,05, zero lead/pubblicazioni.

Costo totale dei canary di questa correzione: €0,15. Entrambi entro il cap individuale €0,125; nessuna customer publication; nessun worker attivato.

### Correzioni successive, solo offline

- Normalizzatore completa i campi strutturali mancanti senza creare evidenze, aziende o osservazioni.
- Il parser deterministico impone un signal floor per segnali espliciti nella query, impedendo che il modello elimini `hiring`.
- Il gate canary ora richiede segnale hiring, routing signal-led non-Maps, fonti compatibili, SME sizing e hard budget.
- Il canary consente una sola chiamata compiler; niente repair pagato nel gate iniziale.
- Test normalizzazione: 18/18 PASS; TypeScript PASS.

### Stato shadow canary

- NON ESEGUITO: l'intent gate live non è passato semanticamente.
- Manifest 10 verticali aggiornato con `intent_gate_status=quarantined` e telemetria source-event obbligatoria.
- Non sono stati generati candidati v5, non sono stati interrogati source planner in shadow e non sono stati pubblicati risultati.

### Prossimo comando sicuro

```bash
npm run test:commercial-contract && npm run evaluation:report && npm run evaluation:sources
```

Solo dopo test e preflight verdi si può autorizzare un nuovo singolo intent canary con budget hard; la suite shadow resta vietata finché quel gate non passa. Invarianti: `MIRAX_SEARCH_DISABLED=1`, worker generali inactive+disabled, customer visibility false.

### Deployment evaluation-only

- Build produzione: PASS.
- Deployment immutabile: `https://ecosistema-mirax-o1t95grg6-simodepertis-projects.vercel.app`.
- Alias produzione verificato con release marker v5 e `production_search_disabled=true`.
- Evaluation API anonima verificata fail-closed: HTTP 401.
- Nessuna modifica ai worker; nessuna riattivazione della ricerca generale.

## Checkpoint intent v5 passato e shadow stop-on-first-failure — 2026-07-13

### Intent canary v5 autorizzato

- Run `c9200bae-4c8f-45e2-9872-748074137139`.
- Canary `ab880343-451a-4387-be3b-7c03629290ce`.
- Search `5ac47fa3-42ce-41c3-b876-ce1f465b5c28`.
- Esito: PASS su tutti i gate semantici, contrattuali, costo e pubblicazione.
- Piano: LLM canonico, nessun fallback; strategia `organic_web_search`; required signal `hiring`; fonti `company_careers` e `job_board`; PMI/Italia/esclusione grandi gruppi e brand conservati.
- Chiamate LLM: 1 initial; repair: 0.
- Costo: €0,05 su hard cap €0,125.
- Customer publications: 0.

### Shadow suite v5

- Policy: 10 verticali, 3–5 candidati iniziali, shadow-only, stop-on-first-failure.
- Verticali completate con successo: 0/10.
- Verticali tentate: 1/10 (`accountant`).
- Verticali non eseguite per stop-on-first-failure: 9/10.
- Casi nuovi inseriti in `mirax-gold-v5`: 0.
- Casi adversariali: 0.
- Human Gold Review v5: nessun nuovo candidato disponibile; legacy baseline resta 7 giudizi e non è gate bloccante.

Primo prepare `accountant`:

- Run `7917c1c4-6dbb-4bea-a798-c0fbb310c629`, quarantined prima delle fonti.
- Errore: `commercialista` interpretato come ruolo hiring/commerciale.
- Costo: €0,05 compiler; 0 query fonte; 0 candidati; 0 pubblicazioni.

Shadow corretto `accountant`:

- Run `6c40a75d-a25c-4ca5-ae82-72b463b1d0de`.
- Canary `811d62a2-6856-45ec-b6a5-d727d30bca76`.
- Search `05fbe55e-ad17-4dfa-8624-b2258828e5f1`.
- Fonti selezionate: official registry, official company website, industry publication, recognized local news.
- Query realmente eseguite: 3; pagine interrogate: 30; URL unici: 40.
- Raw extraction: 1; candidato validato: 0; candidato scartato: OVS careers, segnale/entità/PMI non conformi.
- Motivo stop: page budget ed extraction budget; 50 estrazioni ulteriori bloccate dal cost governor.
- Costo totale riconciliato: €0,097056 su hard cap €0,125.
- Customer publications: 0; search finale cancellata; run/canary quarantined.

### Root cause generale

1. Regex ruolo troppo permissiva: `commercialista` conteneva il prefisso `commercial` e attivava hiring.
2. Il parser non trasformava `nuova apertura` e `cambi societari` nei segnali canonici attesi.
3. L'executor interlacciava source-plan e query generiche: le query generiche `nuova apertura` sovrappesavano careers e catene retail prima delle fonti registro/news.
4. La prima chiamata extraction è stata consumata su OVS; il limite costo ha poi bloccato correttamente altre 50 chiamate, evitando overspend ma lasciando zero candidati.
5. Mancava un'allowlist verticale che impedisse a un piano formalmente valido di scegliere segnali semanticamente estranei.

### Correzioni offline dimostrate

- `commercialista` non può più matchare il ruolo commerciale/hiring.
- `cambi societari` → `registry_change`; `nuova apertura` → `company_formation` + `geographic_expansion`.
- Ogni verticale nel manifest dichiara `expected_signal_any`; il prepare fallisce se il planner aggiunge segnali fuori allowlist.
- Per seller commercialista, l'executor usa prima lane registry/company/news ed elimina degradazione verso Indeed, InfoJobs, careers e `lavora con noi`.
- Test compiler/parser: PASS; test source-plan accountant: PASS; TypeScript: PASS.
- Telemetria source-event riconciliata: costi per query + costo extraction scartata sommano esattamente €0,097056.

### Stato sicuro finale

- `MIRAX_SEARCH_DISABLED=1`.
- 10/10 servizi worker generali inactive; processi one-shot terminati.
- Active job: 0; active canary: 0; stale reservation: 0.
- Negative balances / duplicate charges / customer publications: 0.
- Suite shadow fermata; nessun altro tentativo pagato eseguito dopo la correzione offline.

### Prossimo comando sicuro

```bash
npx tsc --noEmit && \
npx tsx scripts/test-intent-compiler-normalization.ts && \
python -m pytest -q backend_mirror/test_agentic_discovery_v2.py -k "accountant_source_plan or source_plan_drives" && \
npm run evaluation:sources
```

Prima di un nuovo shadow pagato: distribuire la correzione executor sul frozen backend staging, rieseguire preflight e ottenere nuova autorizzazione. Non riprendere casi legacy come gate.

## Convergenza v5.6: causal completion, seller inference e shadow gate isolato — 2026-07-13 06:58 +02:00

### Tentativi successivi quarantinati (nessuna fonte interrogata)

- `insurance_broker` run `2d2600f5-28e3-473b-a9bd-f21969c40719`, canary `1196fd3a-fdc3-46f2-92ab-fc059192972b`, search `427aafaa-83ab-4c39-8c45-53b4eba9166c`: `TRIGGERING_EVENT_MISSING` / `GENERIC_COMMERCIAL_HYPOTHESIS`, costo €0,05.
- `insurance_broker` run `da29818c-50d6-4570-b56e-5232d0318948`, canary `e30f5aef-b246-43a9-b158-716da2f20a1f`, search `b47a6e13-c1df-452a-8db5-99d03ab15b10`: source plan non compatibile, costo €0,05.
- `local_web_agency` run `e462b190-91a5-4295-b5c2-2135f9344532`, canary `5e237006-7fbd-4080-b97e-d0a3a9d8e2ad`, search `efcb0ab7-e59e-43d2-a188-cc771d43c35b`: ipotesi causale mancante, costo €0,05.
- `local_web_agency` run `b39db1fd-4ebb-4775-8423-0f399f0de2b1`, canary `c2e48e44-7889-4fd2-a822-09c8c68a63ca`, search `be28818f-174e-4454-9b9b-2424b53ea447`: stesso gate, costo €0,05.
- Tutti e quattro: 0 query fonte, 0 candidati, 0 pubblicazioni, 0 addebiti cliente. Le verticali `accountant`, `insurance_broker` e `local_web_agency` restano quarantinate e non possono essere ritentate in loop.

### Root cause generale e prova offline

- Il modello poteva omettere seller, problema, buyer role e ipotesi pur rispettando parzialmente il tool schema.
- Il compiler v5.6 completa deterministicamente solo il contesto esplicito dell'utente e le ipotesi di ricerca derivate dall'ontologia; non crea aziende, contatti, osservazioni o prove.
- Corretta la forma con apostrofo `Sono un'agenzia...` e la negazione locale: `PMI non famose con sito debole` conserva `website_weakness`; `non famose` non nega più un segnale successivo.
- Signal floor contestuale: `fleet_expansion`, `hiring_operational`, `website_weakness`; la generica espansione geografica non assorbe più flotta/assunzioni operative.
- Test: parser avversariale 25/25; normalizzazione senza repair PASS; high-value compiler 10/10 verticali; query matrix 137/137; backend mirato 45/45; preflight completo PASS.

### Shadow candidate isolation

- Migration applicata: `2026_07_13_shadow_candidate_isolation.sql`.
- I candidati shadow possono avere `user_id=NULL`, sono solo interni e il DB vieta `stage=published` senza owner.
- Il worker riconosce shadow soltanto con `customer_visible=false` e `lifecycle_stage=v5_shadow`.
- Lo shadow esegue lo stesso gate server-side di produzione, persiste qualified/rejected ed evidenze, ma non invoca mai `publish_search_candidate`.
- Il finalizer non usa più raw results come gold: accetta solo payload `qualified` con dominio, buyer fit, entity resolution, buying signal, evidenza, freshness, causal link, audit, assenza brand/source publisher e budget già passati.
- Test espliciti: shadow qualified persistito con owner nullo e 0 RPC; ownerless non-shadow non persiste e non pubblica.

### Release e stato sicuro

- Frontend produzione: `2026-07-13-deterministic-seller-shadow-gate-v5-6`; `MIRAX_SEARCH_DISABLED=1` verificato.
- Backend staging immutabile: `20260713_064919`, health `8002` OK, worker inactive+disabled.
- Backend live invariato: `20260712_201500_v4`.
- Worker generali: tutti inactive+disabled; `ANTHROPIC_EXTRACT_ENABLED=0` e `MIRAX_WORKER_DISABLED=1` negli env persistenti.
- Active job/canary/stale reservation: 0/0/0. Pubblicazioni/addebiti/duplicati/saldi negativi: 0/0/0/0.
- Gold v5: 0; adversariali DB: 0; giudizi legacy baseline: 7. Nessuna precisione v5 dichiarabile.

### Prossimo comando sicuro

Eseguire un solo `prepare` su una verticale non quarantinata (`software_house`), una chiamata compiler, nessun repair e hard cap complessivo €0,125. Avviare un unico worker one-shot staging soltanto se il source plan supera tutti i gate. Nessun worker generale e nessuna customer publication.

### Software house quarantinata e release v5.7 — 2026-07-13 07:16 +02:00

- Run `ff9ccc6c-ff69-4963-b789-c43e7f865e9e`, canary `8e395766-5fd9-4672-b2f0-a800e1dd96e6`, search `2f22fe39-d0ce-49b8-a05b-72ff89b8ba75`.
- Fail-closed prima delle fonti: il piano LLM ha prodotto `hiring` generico per l'esplicito `assunzioni tech`; allowlist attesa `hiring_technology|technology_migration|manual_processes`.
- Costo compiler €0,05; repair 0; query fonte 0; candidati 0; pubblicazioni/addebiti cliente 0.
- `software_house` è quarantinata: nessun retry immediato.
- Correzione offline: segnali contestuali `hiring_technology`, `hiring_sales`, `hiring_marketing`, `tech_migration`, `manual_processes`; i segnali hiring specializzati sopprimono il generico.
- Prova: parser avversariale 31/31, high-value compiler 10/10, query matrix 137/137, TypeScript/build/preflight completi PASS.
- Frontend produzione: `2026-07-13-contextual-hiring-migration-v5-7`; brake ricerca ancora `true`.
- Prossimo tentativo consentito: una verticale diversa, `hr_recruitment`, con un solo compiler e senza repair.

## Release staging accountant congelata e verificata — 2026-07-13 03:38:46 +02:00

### Runtime e release

- Backend live invariato: `20260712_201500_v4`.
- Backend staging immutabile attivo: `20260713_030848` in `/home/worker/app/backend-staging`.
- Audit API staging: `active/enabled`, porta isolata `8002`, health `ok`, release marker `20260713_030848`.
- Il controllo iniziale sulla porta `8001` mostrava correttamente il marker live v4; non era un errore della release staging. La porta staging corretta è stata verificata esplicitamente.
- Rollback target presente: `/home/worker/backups/staging-pre-20260713_030848`, release `20260712_201500_v4`.
- Nessuna modifica al backend live.

### Hash freeze locale/remoto

- `agents/web_researcher.py`: `a2a2751ad6080f27f8f3f95cc2acc3937311057f0cc1a60e69614a6c73618527`.
- `test_agentic_discovery_v2.py`: `8848c2dd16c3aa54248270534af459289f3b82d02d31f1233a557ffd2bfcd46c`.
- `scripts/activate-staging-release.sh`: `451c480faee82ceec9c0688e06f091f7c3b75a616e7910da0bdc9b287cf527fa`.
- Tutti i tre hash coincidono tra workspace e release staging.

### Test e preflight

- Remote import/compile: PASS.
- Remote source-plan accountant + long-tail source queries: PASS.
- Parser adversarial accountant: 15/15 PASS.
- Intent normalization: 18/18 PASS, zero repair.
- TypeScript: PASS.
- Canary preflight completo: PASS.
- Query matrix: 137/137 su 15 seller category.
- Backend quality/cost/contract/lifecycle: 41/41 PASS nel preflight.
- Production marker frontend: `2026-07-12-final-hardening-v5`; `MIRAX_SEARCH_DISABLED=1`.

### Stato sicuro prima del nuovo shadow

- Tutti i 13 servizi worker rilevati: `inactive` e `disabled`.
- Processi one-shot: 0.
- Job attivi: 0; canary attivi: 0; reservation stale: 0.
- Pubblicazioni/addebiti cliente: 0; duplicate charge: 0; saldi negativi: 0.
- Neo4j: connesso, 3.091 nodi, 14 tipi di relazione, 14.938 relazioni.
- Supabase: RLS sui contratti critici verificata; ACL reserve/publish fail-closed per anon/auth.
- Casi v5: 0; adversariali: 0; legacy giudicati: 7 (baseline soltanto).

### Prossimo comando sicuro

Eseguire un solo `prepare` shadow `accountant` sul compiler canonico, hard cap complessivo verticale `€0,125`, una chiamata compiler, nessun repair, nessuna pubblicazione. Solo se il piano passa i gate semantici avviare un unico worker one-shot sulla release staging `20260713_030848`.

## High-value contract v5.2 e quarantena accountant — 2026-07-13 04:48:14 +02:00

### Tentativi accountant e anti-loop

- Run `dab2d5dc-88d8-46b2-b0ac-3333837137a9`, canary `9fc485c1-b180-418a-adc3-a54ded6d96ae`, search `3c37b930-4227-484b-b56c-28bd98991d71`: quarantined prima delle fonti.
- Costo compiler: `€0,05000000`; fonti interrogate: 0; candidati: 0; pubblicazioni/addebiti cliente: 0.
- FAILED GATE: seller/buyer high-value contract. Il piano conservava i segnali ma aveva categoria offerta, servizi, problemi, buyer roles e trigger vuoti; buyer problem/need/relevance erano placeholder.
- Fixture sanitizzata: `evaluation/fixtures/accountant-high-value-contract-failure-20260713.json`.
- Run successivo `81f9e77b-647c-4253-ba70-6b9ca70bb590`, canary `dc8ec6c4-4f4d-4ce3-9fcd-bc12faee28ca`, search `8883e202-d7ae-48c6-a3b9-aa2b7c59b36f`: fail-closed `SHADOW_SOURCE_PLAN_INVALID`.
- Costo compiler: `€0,05000000`; fonti interrogate: 0; candidati/pubblicazioni: 0.
- Spesa accountant complessiva riconciliata sui quattro run: `€0,24705600` (`0,05 + 0,097056 + 0,05 + 0,05`).
- Accountant ora `VERTICAL QUARANTINED` per anti-loop: nessun altro tentativo immediato. Si prosegue con una verticale diversa dopo correzione sistemica; accountant verrà riaperto solo dopo prova cross-verticale o nuova fonte concreta.

### Root cause e correzione sistemica

- Root cause: lo schema tool dichiarava gli array seller obbligatori ma consentiva array vuoti e `offer_category=null`; il modello poteva quindi produrre output formalmente valido ma commercialmente vuoto.
- Prompt compiler aggiornato a `commercial-intent-v1.1.0` con causal chain obbligatoria.
- Schema tool dinamico: per query seller-framed impone `minItems=1` su servizi, problemi, buyer roles, trigger, segnali e categoria offerta non nulla; per query dirette categoria+città mantiene la flessibilità Maps.
- Validator semantico fail-closed su seller offer, prodotti/servizi, problemi, buyer roles, query-copy, triggering event e ipotesi generiche.
- Il prepare persiste ora diagnostica compiler strutturata e stampa ID sanitizzati anche su fallimento.
- Lo script di quarantena chiude atomicamente run, canary e search e azzera gli eventuali risultati intermedi.

### High-value publication gate server-side

- Gate pre-pubblicazione esplicito su: buyer fit, azienda operativa, dominio ufficiale, buying signal rilevante, nesso causale segnale-offerta, evidenza, URL, publisher, freshness, why-now, audit, contraddizioni e budget.
- Semantica `OR` e `AND` preservata dal testo originale: una query `A oppure B` accetta un segnale dimostrato; `A e B` richiede entrambi.
- Reason code strutturati: `NO_BUYER_FIT`, `ENTITY_NOT_OPERATING`, `NO_RELEVANT_SIGNAL`, `NO_PROBLEM_FIT`, `EVIDENCE_MISMATCH`, `SOURCE_NOT_VERIFIABLE`, `SIGNAL_NOT_FRESH`, `CRITICAL_CONTRADICTION`, `COST_GATE_FAILED`, `OFFICIAL_DOMAIN_UNRESOLVED`.
- Il costo viene verificato direttamente da `search_budget_state` prima della RPC transazionale di pubblicazione; stato assente o halted fallisce chiuso.

### Test, release e runtime

- Test schema/high-value compiler: 23/23 PASS.
- Query matrix: 137/137 PASS.
- Backend mirato: 59/59 PASS; publication/cost/contract subset successivo 19/19 PASS.
- Frontend produzione: `2026-07-13-high-value-contract-v5-2`, deployment immutabile `https://ecosistema-mirax-by7c6kzs1-simodepertis-projects.vercel.app`.
- Runtime marker: prompt `commercial-intent-v1.1.0`, search brake `true`.
- Backend live invariato: `20260712_201500_v4`.
- Backend staging attivo e immutabile: `20260713_044252`, health porta `8002` OK, worker inactive+disabled.
- Hash `commercial_lifecycle.py`: `1d6a72bd1b14e592ee34bac15a055b931fd581b57b9f960718000bb2c7ff08c3`.
- Hash compiler: `e811651c96645b05a58fb8583afd61814e73ef811365eeabfc8bfa7c49304964`.
- Due release staging intermedie sono state respinte e rollbackate automaticamente perché le fixture/ontology non erano autosufficienti nel layout immutabile. Packaging corretto: fixture, schema, ontology e source registry sono ora inclusi e testati dentro la release.
- Preflight v5.2 completa: PASS. Active jobs/canary/stale reservation/pubblicazioni/addebiti: 0.

### Prossimo comando sicuro

Non ritentare `accountant`. Eseguire un solo prepare sulla verticale `insurance_broker` con hard cap `€0,125`, una chiamata compiler e nessun repair. Avviare fonti/worker one-shot soltanto se il piano v5.2 supera il contratto high-value e la source compatibility.
