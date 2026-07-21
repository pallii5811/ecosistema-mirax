# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-22 01:08 Europe/Rome.

## Checkpoint corrente
- Repository `pallii5811/ecosistema-mirax`; branch `safety/mirax-v5-11-codex-checkpoint`.
- Checkpoint locale/remoto distribuito: `389a546fb196980282aef70282c0b6399bf980f6`.
- Worker staging release `20260722_003124`; frontend preview deployment `dpl_6WCeywCLPVcLY1Ep6hxXrNzzjG6T`.
- Worker persistenti `inactive/disabled`; `MIRAX_SEARCH_DISABLED=1`; produzione intatta.
- Primo canary `b367f0f6-3a7e-4023-8014-7488a5b8b653`: `0/3` lifecycle-published; ledger actual `EUR 0,046466`; quarantinato.
- Unico retry `dc8bcedb-07e2-45f7-83f0-1c9ccf77d553`: canary `2f966578-1f2f-4f36-b269-4c8581bb3294`, `0/3` lifecycle-published; ledger actual `EUR 0,084978`; quarantinato.
- Costo provider live cumulativo della missione: `EUR 0,131444`; zero pubblicazioni e zero addebiti cliente.

## Evidenza e correzioni
- Il primo canary copiava la geografia richiesta e sintetizzava la data corrente: corretto nel checkpoint distribuito, con fixture `antincendio_failed_canary_b367f0f6.json`.
- Il retry ha prodotto due falsi positivi interni, mai pubblicati: ECOSYSTEM/Pomezia e Alpacom/Imola.
- Root cause retry: menu, widget e articoli correlati entravano nel testo semantico; localita estranee potevano contaminare il match geografico e una headline correlata poteva simulare un evento.
- Fixture permanente retry: `backend_mirror/fixtures/antincendio_failed_canary_dc8bcedb.json`.
- Correzione locale: estrazione semantica limitata al contenuto primario (`article/main`), esclusione di navigazione/widget/sidebar, geografia legata a titolo/snippet/excerpt dell'evento.
- Cost guard locale: target piccoli eseguono al massimo `2 x requested_count` batch (minimo 3), senza superare limite engine, reservation o `maximum_search_calls`; target grandi conservano la capacita configurata.
- Hard cap resta controllato prima di ogni operazione pagata dal cost governor; nessun nuovo live eseguito dopo il retry.

## Gate offline
- Regressioni mirate adapter/engine/replay: `60 passed`; engine/resume post-adjustment: `10 passed`.
- Source Adapter: `125 passed` piu routing TypeScript verde.
- Commercial runtime/cost: `81 passed`; paid-operation guards verdi.
- Commercial contract/ontology/compiler: verde; compiler tiered `50/50`.
- Matrice commerciale: `137/137` su 15 categorie.
- Compile Python/TypeScript e Next production build verdi; diff check e secret scan da completare sul checkpoint corrente prima del commit.

## Stato prodotto e prossimo passo sicuro
- Il prodotto non e certificato completo: l'ultimo live ha `0/3` lead lifecycle-published.
- Nessun altro canary e autorizzato in questo ciclo; non allentare evidence, identity o market-scope gate.
- Prossimo passo: completare compile/build/secret scan, commit/push atomico, deploy staging immutabile e verificare runtime sicuro. Un futuro live richiede una nuova autorizzazione esplicita e deve riusare cache/evidenze esistenti.
