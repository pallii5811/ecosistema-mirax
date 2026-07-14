# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-14 21:08 Europe/Rome

## Checkpoint corrente

- Repository: `pallii5811/ecosistema-mirax`
- Branch: `safety/mirax-v5-11-codex-checkpoint`
- Checkpoint operativo verificato locale/remoto: `70f45bfb47f580588f023cde87768da42ca42e18`
- Working tree iniziale pulito; processi Git orfani rimossi.
- Direttiva vincolante: `docs/MIRAX_CODEX_MASTER_DIRECTIVE.md`.

## Release corrente

- Staging immutabile: `20260714_190504`
- Health: PASS, `mirax-worker-api`
- Hash `worker_supabase.py`: locale/staging `dbcb0871545831f133a37ff75634bb4e27cc4a2621510ecb1f4e71e4e793475e`
- Rollback: `/home/worker/backups/staging-pre-20260714_190504`
- Produzione: non modificata; `MIRAX_SEARCH_DISABLED=1`
- Servizi persistenti: 6/6 `inactive+disabled`
- Staging persistente: `MIRAX_WORKER_DISABLED=1`, `ANTHROPIC_EXTRACT_ENABLED=0`

## Gate superati

- Checkpoint locale uguale al remoto.
- Preflight canary completo PASS.
- Contratto commerciale 24/24; lifecycle 21/21; human-review security 15/15.
- Query matrix 137/137; high-value compiler 10/10; signal floor 10/10; parser reale 55/55.
- Backend quality/cost 28/28; canonical boundary 9/9; lifecycle/governor 18/18.
- Runtime sicuro: active jobs 0; active canaries 0; stale reservations 0.
- Customer publications 0; customer charges 0; duplicate charges 0; negative balances 0.
- Replay plan hiring implementato con `--reuse-last-plan`; il percorso richiede ledger compiler zero.

## Gate falliti

- Gate 1 hiring: non ancora superato; nessun run ha prodotto 5 lead QUALIFIED.
- Gate website/digital: non iniziato, bloccato dal Gate 1.
- Gate qualità, batch 100/500/5.000, universalità e Stage 1: non iniziati.
- Gold v5: 0/160; adversariali reali: 0/15; legacy human baseline: 7/25.

## Metriche reali

- Ultimo broad retry: costo €0,12316; qualified 0; quarantinato.
- Ultimo hiring fallback completato: costo €0,116446; raw 5; qualified 0; scarti prevalenti `OFFICIAL_DOMAIN_UNRESOLVED`.
- Ultimo prepare fallito per timeout compiler: costo €0,05; candidati 0; quarantinato.
- Precisione v5: non calcolabile.
- Costo per qualified: non calcolabile finché qualified=0.

## Root cause aperte

- La correzione quality-before-stop, oversampling e filtro portali/enterprise è distribuita, ma non è ancora stata verificata da un nuovo canary.
- Il piano hiring deve essere riutilizzato senza compilazione LLM e deve superare nuovamente 19/19 gate con ledger compiler esattamente zero.
- Il canary successivo deve dimostrare 5 qualified completi entro €0,125; in caso contrario va quarantinato senza retry pagato e va isolato un solo rejection gate predominante tramite replay offline.

## Prossima attività esatta

Eseguire `prepare-workplace-safety-controlled.ts --fallback-hiring --reuse-last-plan`, verificare nuovi search/canary/evaluation ID, 19/19 gate e compiler ledger zero; poi autorizzare un solo search ID ed eseguire un solo one-shot staging shadow entro €0,125, senza publication o charge cliente.
