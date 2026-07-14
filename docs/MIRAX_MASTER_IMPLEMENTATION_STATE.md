# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-14 22:10 Europe/Rome

## Checkpoint corrente

- Repository: `pallii5811/ecosistema-mirax`
- Branch: `safety/mirax-v5-11-codex-checkpoint`
- Base locale/remota verificata: `b286db4676a1b6330b10101ac74ad5c7dd06a468`
- Correzione dominio canonico + query reservation validata offline e pronta per commit atomico.
- Direttiva vincolante: `docs/MIRAX_CODEX_MASTER_DIRECTIVE.md`.

## Release corrente

- Staging immutabile corrente: `20260714_190504`.
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
- Nessun nuovo canary eseguito dopo le correzioni.

## Metriche reali

- Canary precedente: discovered `86`; raw `22`; unique entities `8`; audited `8`; evidence verified `0`; qualified `0`; rejected `8`.
- Rejection code precedente: `OFFICIAL_DOMAIN_UNRESOLVED` su `8/8`.
- Customer publications: `0`; customer charges: `0`.
- Gold v5: `0/160`; adversariali reali: `0/15`; legacy human baseline: `7/25`.

## Root cause aperte

- Nessuna delle due root cause resta aperta offline.
- Restano da dimostrare deploy immutabile, runtime sicuro e un solo canary shadow reale entro hard cap.

## Prossima attività esatta

Creare e pushare il commit atomico, verificare lo SHA remoto, distribuire staging immutabile, verificare worker spenti e database pulito; solo allora preparare con `--reuse-last-plan` ed eseguire un singolo canary hiring shadow `requested_count=5` senza compilazione LLM.
