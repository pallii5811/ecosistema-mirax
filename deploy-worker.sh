#!/usr/bin/env bash
# MIRAX — deploy worker staging 116 (Git Bash / WSL)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-root@116.203.137.39}"
REMOTE_DIR="/home/worker/app/backend-staging"
SERVICE="mirax-worker-staging"
API_SERVICE="mirax-audit-api-staging"

echo "==> SCP Python backend -> ${HOST}:${REMOTE_DIR}"
scp "${ROOT}/backend_mirror/"*.py "${HOST}:${REMOTE_DIR}/"

echo "==> Verifica import competitor_track + waterfall"
ssh "$HOST" "cd ${REMOTE_DIR} && python3 -c \"import competitor_track; import waterfall_enrich; import business_events_enrich; print('imports OK')\""

echo "==> Restart services"
ssh "$HOST" "systemctl restart ${API_SERVICE} && systemctl restart ${SERVICE} && systemctl is-active ${SERVICE}"

echo "==> Health check"
ssh "$HOST" "curl -sf http://127.0.0.1:8002/health | head -c 200; echo"

echo "==> Worker deploy completato"
