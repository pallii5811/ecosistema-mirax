# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-21 23:55 Europe/Rome.

## Checkpoint corrente
- Repository `pallii5811/ecosistema-mirax`; branch `safety/mirax-v5-11-codex-checkpoint`.
- Checkpoint locale/remoto precedente: `210d0535255e5d2a5f91edcf1f77a1aa38540530`.
- Release worker staging precedente: `20260721_233422`; worker persistenti `inactive/disabled`.
- Ultimo canary `b367f0f6-3a7e-4023-8014-7488a5b8b653`: `0/3` lifecycle-published, costo progress `EUR 0,085864`, ledger actual `EUR 0,046466`; run quarantinato/fallito, nessun retry eseguito.
- Funnel canary: `2` orchestrator-qualified interni, `0` lifecycle-published; ECOSYSTEM/Pomezia e TBK/Calabria erano fuori geografia e sono rimasti non pubblicati.
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
- Root cause live dimostrata: il Generic Web Adapter copiava la geografia richiesta nei record e sostituiva una data fonte assente con la data corrente.
- Correzione offline: geografia derivata solo da testo fonte con mapping localita/regioni/macro-aree italiane; geografia specifica assente respinta; data evento assente resta `None`.
- Fixture permanente: `backend_mirror/fixtures/antincendio_failed_canary_b367f0f6.json`.
- Regressioni post-fix: `33 passed` mirate, `108 passed` adapter/semantic/orchestrator, Source Adapter `125 passed`, runtime/cost `81 passed`, contract e matrice `137/137`; TypeScript e build Next verdi.
- Nuovo costo provider dopo il canary fallito: `EUR 0`; nessuna pubblicazione o addebito cliente.

## Gate ancora aperti
- Riesecuzione della fascia completa post-mapping, commit/push e deploy staging immutabile del nuovo checkpoint.
- Verifica SHA worker/frontend, health, worker persistenti spenti e reservation stale zero.
- Un solo retry live antincendio esatto e consentito solo dopo tutti i gate offline; pass solo con `3` lifecycle-published lead reali e review manuale.
- Query matrix live, requested-count, UI/API/CSV e graph-first restano non certificati.

## Prossima attivita esatta
- Rieseguire gate completi post-fix; secret scan; commit/push; deploy staging immutabile; preflight sicuro; poi valutare un solo retry con cache entro ledger cumulativo `EUR 2,70`.
