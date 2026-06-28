#!/usr/bin/env bash
# Blocco 9 — Monitoring base worker (journalctl + health)
# Uso: ./backend_mirror/scripts/monitor-worker.sh [staging|prod]
set -euo pipefail

MODE="${1:-staging}"

if [[ "$MODE" == "prod" ]]; then
  HOST="${MONITOR_HOST:-worker@178.0.0.0}"
  SERVICE="mirax-worker-user"
  HEALTH_URL="http://127.0.0.1:8001/health"
else
  HOST="${MONITOR_HOST:-worker@116.203.137.39}"
  SERVICE="mirax-worker-staging"
  HEALTH_URL="http://127.0.0.1:8002/health"
fi

echo "==> Monitor ${MODE} @ ${HOST}"
echo "--- systemctl status ${SERVICE} ---"
ssh "$HOST" "sudo systemctl status ${SERVICE} --no-pager -l | head -20" || true

echo "--- ultimi errori journal (15 min) ---"
ssh "$HOST" "sudo journalctl -u ${SERVICE} --since '15 min ago' -p err --no-pager | tail -30" || true

echo "--- health ---"
ssh "$HOST" "curl -sf ${HEALTH_URL} && echo" || echo "ALERT: health check FAILED"

echo "--- job pending (grep rapido log) ---"
ssh "$HOST" "sudo journalctl -u ${SERVICE} -n 30 --no-pager | tail -15"
