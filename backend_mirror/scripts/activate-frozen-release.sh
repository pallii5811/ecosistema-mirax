#!/usr/bin/env bash
# Deploy identical backend code to live/staging while the production brake is frozen.
set -Eeuo pipefail

ARCHIVE="${1:?archive required}"
RELEASE_ID="${2:?release id required}"
APP_ROOT="/home/worker/app"
PYTHON="${APP_ROOT}/venv/bin/python"
RELEASES="${APP_ROOT}/releases"
BACKUPS="/home/worker/backups"
LIVE="${APP_ROOT}/backend"
STAGING="${APP_ROOT}/backend-staging"
NEW_LIVE="${RELEASES}/mirax-live-${RELEASE_ID}"
NEW_STAGING="${RELEASES}/mirax-staging-${RELEASE_ID}"
BACKUP="${BACKUPS}/final-hardening-pre-${RELEASE_ID}"
FAILED="${BACKUPS}/final-hardening-failed-${RELEASE_ID}"
WORKERS=(mirax-worker-staging mirax-worker-staging-2 mirax-worker-staging-3 mirax-worker-staging-4 mirax-worker-user mirax-worker-user-2 mirax-worker-user-3 mirax-worker-user-4 mirax-worker-user-5 mirax-worker-user-6)
SWAPPED=0

rollback() {
  local code=$?
  if [ "${SWAPPED}" = "1" ]; then
    systemctl stop mirax-audit-api-staging "${WORKERS[@]}" 2>/dev/null || true
    mkdir -p "${FAILED}"
    [ -d "${LIVE}" ] && mv "${LIVE}" "${FAILED}/backend" || true
    [ -d "${STAGING}" ] && mv "${STAGING}" "${FAILED}/backend-staging" || true
    [ -d "${BACKUP}/backend" ] && mv "${BACKUP}/backend" "${LIVE}" || true
    [ -d "${BACKUP}/backend-staging" ] && mv "${BACKUP}/backend-staging" "${STAGING}" || true
    systemctl restart mirax-audit-api-staging 2>/dev/null || true
    systemctl stop "${WORKERS[@]}" 2>/dev/null || true
  fi
  echo "frozen activation failed; rollback completed (exit=${code})" >&2
  exit "${code}"
}
trap rollback ERR

mkdir -p "${RELEASES}" "${BACKUPS}" "${BACKUP}"
test ! -e "${NEW_LIVE}"
test ! -e "${NEW_STAGING}"
mkdir -p "${NEW_LIVE}" "${NEW_STAGING}"
tar xzf "${ARCHIVE}" -C "${NEW_LIVE}"
tar xzf "${ARCHIVE}" -C "${NEW_STAGING}"

for pair in "${LIVE}:${NEW_LIVE}" "${STAGING}:${NEW_STAGING}"; do
  old="${pair%%:*}"
  new="${pair##*:}"
  cp -a "${old}/.env" "${new}/.env"
  [ -d "${old}/data" ] && cp -a "${old}/data" "${new}/data" || true
  find "${old}" -maxdepth 1 -type f -name '*.db*' -exec cp -a {} "${new}/" \;
  printf '%s\n' "${RELEASE_ID}" > "${new}/.release-id"
  chown -R worker:worker "${new}"
  (
    cd "${new}"
    "${PYTHON}" -m py_compile worker_supabase.py cost_governor.py commercial_lifecycle.py url_safety.py adaptive_audit.py agents/*.py universe/*.py
    set -a
    # shellcheck disable=SC1091
    source ./.env
    set +a
    "${PYTHON}" -c 'import worker_supabase; import commercial_lifecycle; import cost_governor; import url_safety; import adaptive_audit; print("frozen release imports OK")'
  )
done

systemctl stop "${WORKERS[@]}" 2>/dev/null || true
systemctl disable "${WORKERS[@]}" 2>/dev/null || true
mv "${LIVE}" "${BACKUP}/backend"
mv "${STAGING}" "${BACKUP}/backend-staging"
mv "${NEW_LIVE}" "${LIVE}"
mv "${NEW_STAGING}" "${STAGING}"
SWAPPED=1

# Only the read-only/internal audit APIs are restarted. Search workers remain frozen.
systemctl restart mirax-audit-api mirax-audit-api-staging
sleep 3
systemctl is-active --quiet mirax-audit-api
systemctl is-active --quiet mirax-audit-api-staging
curl -sf --max-time 10 http://127.0.0.1:8001/health
curl -sf --max-time 10 http://127.0.0.1:8002/health
for service in "${WORKERS[@]}"; do
  test "$(systemctl is-active "${service}" 2>/dev/null || true)" != "active"
  test "$(systemctl is-enabled "${service}" 2>/dev/null || true)" != "enabled"
done

SWAPPED=0
rm -f "${ARCHIVE}"
trap - ERR
echo
echo "frozen release ${RELEASE_ID} active; backup=${BACKUP}; workers=inactive+disabled"
