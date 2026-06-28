#!/usr/bin/env bash
# Blocco 9 — Deploy worker su PRODUZIONE (178:8001) — SOLO dopo test staging + backup
# Uso: CONFIRM_PROD=1 ./backend_mirror/scripts/deploy-prod.sh [user@host]
set -euo pipefail

if [[ "${CONFIRM_PROD:-}" != "1" ]]; then
  echo "ERRORE: imposta CONFIRM_PROD=1 dopo aver completato DEPLOY_CHECKLIST.md"
  exit 1
fi

HOST="${1:-worker@178.0.0.0}"
REMOTE_DIR="/home/worker/app/backend"
SERVICE="mirax-worker-user"
API_SERVICE="mirax-audit-api"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="/home/worker/backups/prod_${TS}"

echo "==> MIRAX deploy PROD -> ${HOST}:${REMOTE_DIR}"
echo "    ATTENZIONE: produzione miraxgroup.it"

ssh "$HOST" "mkdir -p ${BACKUP_DIR} && cp -a ${REMOTE_DIR}/*.py ${BACKUP_DIR}/ && cp -a ${REMOTE_DIR}/.env ${BACKUP_DIR}/.env.bak"
echo "    Backup remoto: ${BACKUP_DIR}"

rsync -avz \
  --exclude '.env' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "${LOCAL_DIR}/worker_supabase.py" \
  "${LOCAL_DIR}/audit_engine.py" \
  "${LOCAL_DIR}/main.py" \
  "${HOST}:${REMOTE_DIR}/"

echo "==> Restart one-by-one (no downtime totale se più istanze)"
for svc in mirax-worker-user mirax-worker-user-2 mirax-worker-user-3; do
  ssh "$HOST" "sudo systemctl is-enabled ${svc} 2>/dev/null && sudo systemctl restart ${svc} && sleep 3" || true
done

ssh "$HOST" "sudo systemctl restart ${API_SERVICE}"
ssh "$HOST" "curl -sf http://127.0.0.1:8001/health | head -c 200"

echo "==> Deploy prod completato. Verifica: journalctl -u ${SERVICE} -n 50"
