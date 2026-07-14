# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-14 22:43 Europe/Rome

## Checkpoint corrente

- Repository: `pallii5811/ecosistema-mirax`
- Branch: `safety/mirax-v5-11-codex-checkpoint`
- Checkpoint implementazione/release verificato: `dbf284f6b56929e16db625015d573089f02bff58`.
- Correzione dominio canonico + query reservation committata, pushata e distribuita.
- Direttiva vincolante: `docs/MIRAX_CODEX_MASTER_DIRECTIVE.md`.

## Release corrente

- Staging immutabile corrente: `20260714_213027`.
- Rollback: `/home/worker/backups/staging-pre-20260714_213027`.
- Hash `worker_supabase.py` locale/staging: `b29d179ea8a027ba467821b4367772681c3cc00d69d3ab550436ed4acc6e76e4`.
- Produzione non modificata; `MIRAX_SEARCH_DISABLED=1`.
- Servizi persistenti: `6/6 inactive+disabled`.
- Staging persistente: `MIRAX_WORKER_DISABLED=1`, `ANTHROPIC_EXTRACT_ENABLED=0`.

## Gate superati

- Replay end-to-end reale: `6/6 PASS`.
- Otto candidati con identità realmente risolta: `8/8` non ricevono più `OFFICIAL_DOMAIN_UNRESOLVED`.
- Portale, dominio mismatch e ownership insufficiente: promozione canonica bloccata fail-closed.
- Reservation da una query: esattamente `1` provider call; tentativi successivi bloccati prima della call.
- Costo simulato replay: `€0,045846 < €0,125`.
- Costo reservation regression: `€0,123 <= €0,125`; ulteriore call rifiutata prima dell'esecuzione.
- Runtime/cost/lifecycle mirati: `55/55 PASS`; suite commercial runtime: `58/58 PASS`.
- Contratto commerciale `24/24`; Python contract `9/9`; query matrix `137/137`; vertical manifest `10/10`.
- TypeScript compile, Python compile, `git diff --check` e scansione segreti: PASS.
- Nuovi file temporanei/untracked: `0`; file legacy tracciati fuori scope preservati.

## Gate falliti

- Canary hiring precedente `8235d575-ded7-4fdb-aaf3-4a3575d91681`: quarantinato.
- Qualified precedente: `0/5`.
- Costo precedente: `€0,130665 > €0,125`.
- Canary post-correzione `72578395-853d-4675-beae-ffeae0f6ba9c`: `qualified 0/5`, quarantinato senza retry.

## Metriche reali

- Canary post-correzione: discovered `71`; raw `13`; unique entities `4`; resolved `4`; audited `4`; evidence verified `0`; qualified `0`; rejected `4`.
- Rejection codes: `ENTITY_NOT_OPERATING 4`, `EVIDENCE_MISMATCH 4`, `SOURCE_NOT_VERIFIABLE 4`, `SIGNAL_NOT_FRESH 4`, `NO_RELEVANT_SIGNAL 1`, `NO_PROBLEM_FIT 1`.
- Costo totale: `€0,124878`; costo per qualified: non calcolabile (`qualified=0`).
- Compiler/repair/LLM del piano: `0/0/0`; query round finale autorizzate/eseguite: `1/1`.
- Customer publications: `0`; customer charges: `0`.
- Gold v5: `0/160`; adversariali reali: `0/15`; legacy human baseline: `7/25`.

## Root cause aperte

- Le due root cause oggetto del checkpoint sono chiuse anche nel canary: `4/4` domini ufficiali risolti e costo sotto hard cap.
- Root cause successiva isolata: i quattro candidati non soddisfano entity classification/evidence contract/freshness; i payload usano ancora alias segnale `hiring` e non producono evidenza lifecycle pubblicabile.

## Prossima attività esatta

Riprodurre offline i quattro payload del canary quarantinato e correggere in modo generale entity classification, canonical signal alias ed evidence/freshness contract. Non eseguire un altro canary pagato prima di una nuova correzione dimostrata offline.
