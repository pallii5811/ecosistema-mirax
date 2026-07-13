# MIRAX rollback runbook

## Backend

- Il deploy frozen crea `/home/worker/backups/final-hardening-pre-<release>` prima dello swap.
- L'activator compila/importa prima dello swap; dopo lo swap riavvia l'audit API e verifica health/worker state.
- Qualunque errore post-swap sposta la release fallita, ripristina live+staging dal backup, riavvia l'audit API e mantiene i worker spenti.
- Rehearsal v5b: startup ASGI intenzionalmente fallito, exit 3, rollback automatico PASS.

Verifiche obbligatorie dopo rollback:

```bash
cat /home/worker/app/backend/.release-id
cat /home/worker/app/backend-staging/.release-id
systemctl is-active mirax-audit-api-staging
curl -sf http://127.0.0.1:8002/health
pgrep -f '[w]orker_supabase.py'
```

## Frontend

- Identificare la deployment Vercel precedente `Ready` con marker atteso.
- Promuovere la deployment immutabile precedente, mantenendo `MIRAX_SEARCH_DISABLED=1`.
- Verificare `/api/ops/release`, homepage e review/API auth.
- Non usare rollback frontend per riabilitare ricerca o vecchi endpoint unmetered.

## Database

- Le migration finali sono additive/idempotenti; nessun rollback distruttivo automatico.
- In incidente applicativo lasciare tabelle/ledger intatti e fare rollback del codice.
- Qualunque down migration richiede backup, rehearsal separato e approvazione esplicita.
