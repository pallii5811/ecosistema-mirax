# MIRAX incident and kill-switch runbook

## Trigger immediato

Attivare il kill switch per: costo fuori cap, lead intermedi visibili, big brand pubblicata, evidence gate bypassato, doppi addebiti, reservation orfane, worker concorrenti non autorizzati o provider retry storm.

## Contenimento

1. Impostare `MIRAX_SEARCH_DISABLED=1` su Vercel production e promuovere una nuova deployment solo se la modifica environment non è già effettiva.
2. Sul server 116: impostare `MIRAX_WORKER_DISABLED=1`, `ANTHROPIC_EXTRACT_ENABLED=0` in live/staging.
3. Eseguire `systemctl stop` e `systemctl disable` per tutte le unità `mirax-worker-staging*` e `mirax-worker-user*`.
4. Non cancellare search, ledger o publication: conservarli per reconciliation.
5. Verificare `pgrep -f '[w]orker_supabase.py'` vuoto.

## Verifica contenimento

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run preflight:canary
node scripts/verify-final-runtime-state.mjs
```

Atteso: marker brake true; worker inactive+disabled; job attivi 0; reservation stale 0; duplicate charges 0.

## Reconciliation

- Recuperare reservation stale in modo conservativo.
- Confrontare cost ledger con provider usage; non assumere costo zero per timeout ambiguo.
- Rimborsare solo publication charge idempotenti e realmente revocate.
- Quarantinare canary/run difettosi, non riscriverne le metriche.

## Ripartenza

Solo tramite canary isolata, un worker, shadow mode, budget hard e stop-on-first-failure. Mai riattivare tutti i worker come primo passo.
