# Deploy worker MIRAX — Checklist (Blocco 9)

## Prima di ogni deploy

- [ ] `npm run test:block1` … `test:block8` passano in locale
- [ ] `npm run check:staging-env` — nessun puntamento a Supabase prod
- [ ] Diff revisionato: `worker_supabase.py`, `audit_engine.py`, `main.py`
- [ ] Backup remoto confermato (script crea `backups/staging_*` o `prod_*`)

## Staging (116:8002)

```bash
# Da Git Bash / WSL / Linux con SSH configurato
chmod +x backend_mirror/scripts/*.sh
./backend_mirror/scripts/deploy-staging.sh worker@116.203.137.39
./backend_mirror/scripts/monitor-worker.sh staging
```

Verifica locale:

```bash
npm run check:worker-health
curl http://116.203.137.39:8002/health
```

## Produzione (178:8001) — solo Blocco 10

```bash
CONFIRM_PROD=1 ./backend_mirror/scripts/deploy-prod.sh worker@<IP_178>
./backend_mirror/scripts/monitor-worker.sh prod
```

**Rollback:** ripristina `.py` da `/home/worker/backups/prod_<timestamp>/` e `systemctl restart`.

## Servizi systemd

| Ambiente | Worker | API audit | Porta |
|----------|--------|-----------|-------|
| Staging | `mirax-worker-staging` | `mirax-audit-api-staging` | 8002 |
| Prod | `mirax-worker-user` (+2..6) | `mirax-audit-api` | 8001 |

## Monitoring automatico (Vercel cron)

`GET /api/ops/worker-health` con header `Authorization: Bearer $CRON_SECRET`

Alert in risposta JSON se `/health` non risponde.

## AI Act audit trail

Dopo migration `2026_06_28_ai_audit_trail.sql`:

- `POST /api/outreach/log` scrive in `ai_audit_trail`
- `GET /api/compliance/audit-trail` — export utente
- `POST /api/compliance/explain-lead` — score motivation + technical_report
