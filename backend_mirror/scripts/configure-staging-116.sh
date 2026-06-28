#!/usr/bin/env bash
# Configura il 116 come host SOLO dev/staging: libera RAM, swap anti-OOM, max 2 servizi Mirax attivi.
# Prod Mirax gira su 178 — i worker prod su 116 sono ridondanti e saturano i 4GB.
# Uso (da root sul server): bash configure-staging-116.sh
set -euo pipefail

SWAPFILE="/swapfile"
SWAP_GB=4

echo "==> [1/4] Swap ${SWAP_GB}G (se assente)"
if ! swapon --show 2>/dev/null | grep -q "${SWAPFILE}"; then
  if [[ ! -f "${SWAPFILE}" ]]; then
    fallocate -l "${SWAP_GB}G" "${SWAPFILE}" 2>/dev/null || dd if=/dev/zero of="${SWAPFILE}" bs=1M count=$((SWAP_GB * 1024)) status=progress
    chmod 600 "${SWAPFILE}"
    mkswap "${SWAPFILE}"
  fi
  swapon "${SWAPFILE}"
  grep -qF "${SWAPFILE}" /etc/fstab 2>/dev/null || echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
  echo "    Swap attivato: ${SWAPFILE}"
else
  echo "    Swap già presente"
fi

echo "==> [2/4] vm.swappiness=10 (usa swap prima dell'OOM killer)"
sysctl -w vm.swappiness=10 >/dev/null
mkdir -p /etc/sysctl.d
echo "vm.swappiness=10" > /etc/sysctl.d/99-mirax-staging.conf

echo "==> [3/4] Stop worker/API PROD su 116 (prod su 178)"
PROD_SERVICES=(
  mirax-audit-api
  mirax-worker
  mirax-worker-6
  mirax-worker-7
  mirax-worker-user
  mirax-worker-user-2
  mirax-worker-user-3
  mirax-worker-user-4
  mirax-worker-user-5
  mirax-worker-user-6
)
for svc in "${PROD_SERVICES[@]}"; do
  if systemctl is-active --quiet "${svc}" 2>/dev/null; then
    systemctl stop "${svc}"
    echo "    stopped ${svc}"
  fi
  if systemctl is-enabled --quiet "${svc}" 2>/dev/null; then
    systemctl disable "${svc}"
    echo "    disabled ${svc}"
  fi
done

echo "==> [4/4] Staging: OOM priority + restart"
mkdir -p /etc/systemd/system/mirax-worker-staging.service.d
cat > /etc/systemd/system/mirax-worker-staging.service.d/override.conf <<'EOF'
[Service]
OOMScoreAdjust=-500
EOF
mkdir -p /etc/systemd/system/mirax-audit-api-staging.service.d
cat > /etc/systemd/system/mirax-audit-api-staging.service.d/override.conf <<'EOF'
[Service]
OOMScoreAdjust=-400
EOF

systemctl daemon-reload
systemctl enable mirax-worker-staging mirax-audit-api-staging

# Worker staging deve processare TUTTI i pending (non solo ultimi 10 min)
if grep -q 'worker_supabase.py --mode user --cooldown 5"' /etc/systemd/system/mirax-worker-staging.service 2>/dev/null; then
  sed -i 's/worker_supabase.py --mode user --cooldown 5"/worker_supabase.py --mode user --cooldown 5 --user-recent-minutes 0"/' /etc/systemd/system/mirax-worker-staging.service
  systemctl daemon-reload
fi

systemctl restart mirax-audit-api-staging mirax-worker-staging

echo "==> Stato finale"
free -h
echo "---"
systemctl list-units 'mirax*' --no-pager --no-legend
echo "---"
curl -sf http://127.0.0.1:8002/health | head -c 120 || curl -sf http://127.0.0.1:8002/openapi.json | head -c 80
echo ""
echo "==> configure-staging-116 completato"
