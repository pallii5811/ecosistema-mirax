#!/usr/bin/env bash
# MIRAX — deploy worker staging 116 (Git Bash / WSL)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-root@116.203.137.39}"
REMOTE_DIR_STAGING="/home/worker/app/backend-staging"
REMOTE_DIR_LIVE="/home/worker/app/backend"
SERVICE="mirax-worker-staging"
API_SERVICE="mirax-audit-api-staging"
VENV_PYTHON="/home/worker/app/venv/bin/python"

LOCAL_TAR="/tmp/backend_mirror.tar.gz"
REMOTE_TAR="/tmp/backend_mirror.tar.gz"

echo "==> Pack Python backend"
rm -f "${LOCAL_TAR}"
tar czf "${LOCAL_TAR}" \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='.env' \
  -C "${ROOT}/backend_mirror" .

echo "==> SCP archive -> staging + live"
scp "${LOCAL_TAR}" "${HOST}:${REMOTE_TAR}"

ssh "$HOST" "
  set -e
  echo '==> Extract staging'
  cd ${REMOTE_DIR_STAGING} && tar xzf ${REMOTE_TAR}
  echo '==> Extract live'
  cd ${REMOTE_DIR_LIVE} && tar xzf ${REMOTE_TAR}
  rm -f ${REMOTE_TAR}
"

echo "==> Verifica import competitor_track + waterfall"
ssh "$HOST" "cd ${REMOTE_DIR_STAGING} && ${VENV_PYTHON} -c \"import competitor_track; import waterfall_enrich; import business_events_enrich; print('imports OK')\""

echo "==> Restart services"
ssh "$HOST" "systemctl restart ${API_SERVICE} && systemctl restart ${SERVICE} && systemctl is-active ${SERVICE}"

echo "==> Health check"
ssh "$HOST" "curl -sf http://127.0.0.1:8002/health | head -c 200; echo"

echo "==> Worker deploy completato"
