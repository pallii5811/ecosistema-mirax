# Backend Mirror

Copia locale dei file backend/worker dal server `116.203.137.39`.

**Data snapshot**: 9 Aprile 2026, 15:42 UTC+2

## File principali

| File | Descrizione |
|------|-------------|
| `worker_supabase.py` | Worker principale che processa i job di scraping dalla tabella `searches` |
| `main.py` | Backend FastAPI con scraper Google Maps (Playwright), audit siti, estrazione email |
| `audit_engine.py` | Engine di audit tecnico per siti web |
| `report_generator.py` | Generatore report PDF audit |
| `requirements.txt` | Dipendenze Python |
| `.env` | Variabili d'ambiente (Supabase URL/key, DEMO_MAX_RESULTS) |

## Systemd Services

In `systemd/all_services.txt` ci sono tutte le configurazioni dei servizi systemd:
- `mirax-worker.service` — Worker backlog (mode: backlog, cooldown 20s)
- `mirax-worker-user.service` — Worker user realtime (mode: user, cooldown 2s)
- `mirax-worker-user-2..6.service` — Worker user aggiuntivi
- `mirax-worker-6.service`, `mirax-worker-7.service` — Worker aggiuntivi
- `mirax-audit-api.service` — FastAPI audit API sulla porta 8001

## NON MODIFICARE (riferimento)

Questi file sono una copia di riferimento sincronizzata dal server. Per deploy:

- Staging: `backend_mirror/scripts/deploy-staging.sh`
- Prod: `backend_mirror/scripts/deploy-prod.sh` (richiede `CONFIRM_PROD=1`)
- Checklist: `DEPLOY_CHECKLIST.md`
