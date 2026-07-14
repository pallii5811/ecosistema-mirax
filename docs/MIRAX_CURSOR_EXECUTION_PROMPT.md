# MIRAX Cursor Auto Execution Prompt

Incolla integralmente il blocco seguente in Cursor Auto.

---

Agisci come Principal Software Engineer, Data Engineer e AI Systems Architect responsabile dell'implementazione MIRAX.

Repository: `pallii5811/ecosistema-mirax`

Branch di partenza: `safety/mirax-v5-11-codex-checkpoint`

Checkpoint minimo atteso: `a6a1194724e25697d8ac1ca59a776a1423f7d73e`

## Lettura obbligatoria

Prima di modificare codice leggi, nell'ordine:

1. `docs/MIRAX_CODEX_MASTER_DIRECTIVE.md`
2. `docs/MIRAX_MASTER_IMPLEMENTATION_STATE.md`
3. `docs/MIRAX_SOURCE_ARCHITECTURE_AUDIT.md`
4. `docs/MIRAX_SOURCE_ADAPTER_MATRIX.md`
5. `docs/MIRAX_CURSOR_HANDOFF.md`

L'audit e' gia' stato eseguito. Non ripeterlo e non produrre un'altra strategia generale. Esegui i task numerati del Cursor Handoff in ordine.

## Obiettivo

Costruire il percorso reale:

`query -> compiler canonico -> capability adapter reali -> discovery paginata -> OpportunityCandidate -> entity/domain resolution -> EvidenceRecord -> audit/contatti -> lifecycle -> QualifiedLead -> pubblicazione atomica`.

Il prodotto deve preservare il vecchio Digital Audit funzionante e aggiungere adapter verticali discovery-first. Prima produrre 20 lead validi per trace offline; poi scalare 100, 500 e 5.000 con cursor, exhaustion, dedup e cost control.

## Vincoli non negoziabili

- Non abbassare evidence, freshness, target-fit, entity/domain o publication gate.
- Non trasformare una source lane in una query SERP fingendo che sia un adapter.
- Non usare SERP generica come unica fonte per procurement, hiring o ads quando esiste/serve una fonte verticale.
- Non dichiarare supportata una query se manca acquisition reale: registra `coverage_gap` e stato parziale.
- Non considerare snippet, URL `/jobs`, root careers, directory, publisher, issuer o keyword isolate come evidence.
- Non sostituire `published_at` con crawl time senza dichiarare semantics=`observed`.
- Non promuovere enterprise/famous brand quando il target e' PMI.
- Non fare mega-refactoring, nuove UI, gold review, soak o canary prima dei replay offline verdi.
- Non effettuare test live bug-per-bug. Usa fixture sanitizzate e adapter fake/provider-free.
- Non effettuare provider call non riservate; ogni chiamata deve passare dal cost governor.
- Non inserire segreti nel repository o nei log.
- Non dichiarare risultati non provati da comandi e fixture.

## Metodo operativo

Per ogni task del handoff:

1. Verifica branch, working tree e checkpoint.
2. Leggi soltanto i file indicati e le dipendenze dirette.
3. Scrivi prima il test/fixture negativo e positivo che riproduce il gap.
4. Implementa la modifica minima generale.
5. Esegui il comando di verifica indicato.
6. Esegui compile e diff check proporzionati al task.
7. Scansiona segreti soltanto nei file modificati.
8. Crea un commit atomico con descrizione specifica.
9. Aggiorna sinteticamente `docs/MIRAX_MASTER_IMPLEMENTATION_STATE.md`.
10. Passa al task successivo soltanto quando Definition of Done e' verde.

Se trovi una discrepanza tra audit e codice, documenta evidenza file/funzione nel Master State e correggi il handoff nello stesso commit; non riaprire l'architettura generale.

## Ordine obbligatorio

### Stage 1 — Safety baseline

- Task 1: fixture/regressioni Digital Audit.
- Non cambiare behavior legacy.

### Stage 2 — Contratti e capability

- Task 2: `SourceAdapter`, `OpportunityCandidate`, `EvidenceRecord`, `QualifiedLead`.
- Task 3: `AdapterCatalog` e planner capability-aware.
- Gate: le tre query di trace devono scegliere segnali e adapter corretti offline:
  - gare Torino -> `contract_awarded` + procurement;
  - marketing Lombardia -> `active_advertising` + ads/technology;
  - personale operativo Italia -> `hiring_operational` + hiring.

### Stage 3 — Adapter reali

- Task 4: Procurement Adapter discovery-first usando ANAC index/TED riusabili.
- Task 5: Hiring Adapter discovery-first usando JSON-LD/ATS/job sources consentite.
- Task 6: Ads e Expansion Adapter con coverage esplicita.
- Ogni adapter deve dichiarare supported signals/intents/geography, freshness, pagination, cost, retry, provenance ed exhaustion.

### Stage 4 — Orchestrazione

- Task 7: adapter-first orchestrator; generic web solo fallback partial.
- Usa cost reservation prima di discover/fetch.
- Persisti adapter run, cursor, artifact hash, counts, rejection reason e cost.

### Stage 5 — Qualita' e scala

- Task 8: replay offline 20 per trace.
- Task 9: scale test sintetici 100, 500, 5.000.
- Exact count e' valido soltanto se esistono abbastanza qualified; altrimenti ritorna partial + exhaustion, mai filler.

### Stage 6 — Canary

Non eseguire Task 10 senza autorizzazione esplicita dell'utente. Quando tutti i replay sono verdi, fermati e riporta i gate; chiedi autorizzazione per un solo shadow canary da 20.

## Contratto di output per ogni milestone

Riporta:

- file modificati;
- test/fixture aggiunti;
- comando e risultato;
- funnel offline `discovered -> artifacts -> unique -> resolved -> evidence_verified -> target_fit -> qualified`;
- costo simulato e cost per qualified;
- coverage/exhaustion;
- SHA commit;
- prossimo task esatto.

## Criterio finale

Non fermarti a “adapter creato”. Un vertical e' completato soltanto quando il planner lo seleziona, l'adapter acquisisce davvero dati paginati, produce candidati ed evidence canonica, entity/domain/target fit passano, il lifecycle qualifica 20 lead offline e nessun negativo viene promosso.

Inizia ora dal Task 1 del handoff e continua autonomamente fino al gate pre-canary. Non avviare canary.

---
