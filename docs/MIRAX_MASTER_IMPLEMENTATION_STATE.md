# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-21 Europe/Rome.

## Checkpoint corrente
- Repository `pallii5811/ecosistema-mirax`; branch `safety/mirax-v5-11-codex-checkpoint`.
- Base locale/remota verificata: `05866b9b731af429aad4036c3d79191f8864b4b6`.
- Release staging precedente: `20260721_211903`; worker persistenti `inactive/disabled`.
- Ultimo canary `919147ed-f903-4345-923e-56c8d05edc3c`: `0/3` published, costo `EUR 0,087946`.
- Funnel forensic permanente: `artifacts/codex-current-funnel-audit.json`.

## Gate superati offline
- Retrieval vincolato a `hypothesis_id`; contaminazioni cross-intent bloccate prima del provider con `STRATEGY_INTENT_LEAKAGE` e costo zero.
- Claim separati: evento, azienda, compatibilita ipotesi, inferenza commerciale e domanda esplicita hanno gate/codici distinti.
- Il canary antincendio conserva solo `production_expansion`; nessun fallback funding e fail-closed senza ipotesi valida.
- Expansion osservata senza menzione del prodotto seller e valida come inferenza; selezioni concluse restano respinte.
- Enrichment staged su dominio ufficiale: Organization JSON-LD, size/ownership e contatti; publisher e relativi telefoni esclusi.
- Why-now strutturato e marcato `INFERRED` o `DIRECT`; freshness eredita l'orizzonte canonico.
- Replay canary fallito: 7/7 candidati riconciliati; strategia funding bloccata; candidato expansion entra in enrichment.
- Regressioni MIRAX pertinenti `261 passed`; Source Adapter `125 passed`; runtime/cost `81 passed`.
- Commercial contract verde; compiler tiered `50/50`; matrice commerciale `137/137`; Next build e TypeScript verdi.
- Full collection legacy non eseguibile offline: `test_block1_worker.py` termina all'import senza `SUPABASE_URL`; suite ufficiali non richiedono questo side effect.
- Nuovo costo provider di questa fase: `EUR 0`; nessuna pubblicazione o addebito cliente.

## Gate ancora aperti
- Commit/push e deploy staging immutabile del nuovo checkpoint.
- Verifica SHA worker/frontend, health, worker persistenti spenti e reservation stale zero.
- Un solo canary live antincendio esatto; pass solo con `3` lifecycle-published lead reali e review manuale.
- Query matrix live, requested-count, UI/API/CSV e graph-first restano non certificati.

## Prossima attivita esatta
- Secret scan e diff finale; commit/push; deploy staging immutabile; preflight sicuro; poi singolo canary entro ledger cumulativo `EUR 2,70`.
