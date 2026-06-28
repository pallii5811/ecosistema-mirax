#!/usr/bin/env bash
# Blocco 9 — Deploy worker su STAGING (116:8002)
# Uso: ./backend_mirror/scripts/deploy-staging.sh [user@host]
set -euo pipefail

HOST="${1:-root@116.203.137.39}"
REMOTE_DIR="/home/worker/app/backend-staging"
REMOTE_SCRAPER_DIR="/home/worker/app/backend"
SERVICE="mirax-worker-staging"
API_SERVICE="mirax-audit-api-staging"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="/home/worker/backups/staging_${TS}"

echo "==> MIRAX deploy STAGING -> ${HOST}:${REMOTE_DIR}"

ssh "$HOST" "mkdir -p ${BACKUP_DIR} && cp -a ${REMOTE_DIR}/*.py ${BACKUP_DIR}/ 2>/dev/null || true"
echo "    Backup remoto: ${BACKUP_DIR}"

rsync -avz --delete \
  --exclude '.env' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "${LOCAL_DIR}/" "${HOST}:${REMOTE_DIR}/"

# Lo worker staging importa `backend.main` da /home/worker/app/backend/ — allinea scraper.
for f in main.py audit_engine.py; do
  rsync -avz "${LOCAL_DIR}/${f}" "${HOST}:${REMOTE_SCRAPER_DIR}/${f}"
done
ssh "$HOST" "chown -R worker:worker ${REMOTE_DIR} ${REMOTE_SCRAPER_DIR}/main.py ${REMOTE_SCRAPER_DIR}/audit_engine.py 2>/dev/null || true"

ssh "$HOST" "systemctl restart ${API_SERVICE} && systemctl restart ${SERVICE}"
ssh "$HOST" "sudo systemctl is-active ${SERVICE} && curl -sf http://127.0.0.1:8002/health | head -c 200"

echo "==> Deploy staging completato. Log: journalctl -u ${SERVICE} -f"
