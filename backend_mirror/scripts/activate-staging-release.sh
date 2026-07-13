#!/usr/bin/env bash
# Atomic activation executed on the staging host only.
set -Eeuo pipefail

ARCHIVE="${1:?archive path required}"
RELEASE_ID="${2:?release id required}"
APP_ROOT="/home/worker/app"
CURRENT="${APP_ROOT}/backend-staging"
RELEASES="${APP_ROOT}/releases"
RELEASE="${RELEASES}/mirax-staging-${RELEASE_ID}"
BACKUP="/home/worker/backups/staging-pre-${RELEASE_ID}"
FAILED="/home/worker/backups/staging-failed-${RELEASE_ID}"
PYTHON="${APP_ROOT}/venv/bin/python"
API_SERVICE="mirax-audit-api-staging"
WORKER_SERVICE="mirax-worker-staging"
ACTIVATION_STARTED=0

rollback() {
  local code=$?
  if [ "${ACTIVATION_STARTED}" = "1" ]; then
    systemctl stop "${API_SERVICE}" "${WORKER_SERVICE}" 2>/dev/null || true
    if [ -d "${BACKUP}" ]; then
      if [ -d "${CURRENT}" ]; then mv "${CURRENT}" "${FAILED}" 2>/dev/null || true; fi
      mv "${BACKUP}" "${CURRENT}"
    fi
    systemctl restart "${API_SERVICE}" 2>/dev/null || true
    systemctl stop "${WORKER_SERVICE}" 2>/dev/null || true
    systemctl disable "${WORKER_SERVICE}" 2>/dev/null || true
  fi
  echo "staging activation failed; rollback completed (exit=${code})" >&2
  exit "${code}"
}
trap rollback ERR

mkdir -p "${RELEASES}" /home/worker/backups
test ! -e "${RELEASE}"
test ! -e "${BACKUP}"
mkdir -p "${RELEASE}"
tar xzf "${ARCHIVE}" -C "${RELEASE}"
printf '%s\n' "${RELEASE_ID}" > "${RELEASE}/.release-id"
test -f "${RELEASE}/contracts/fixtures/commercial-search-plan.valid.json"
test -f "${RELEASE}/contracts/signal-ontology.v1.json"
test -f "${RELEASE}/contracts/source-registry.v1.json"
test -f "${RELEASE}/contracts/commercial-search-plan.schema.json"

# Runtime state and secrets are host-owned, never shipped from the workstation.
cp -a "${CURRENT}/.env" "${RELEASE}/.env"
if [ -d "${CURRENT}/data" ]; then cp -a "${CURRENT}/data" "${RELEASE}/data"; fi
find "${CURRENT}" -maxdepth 1 -type f -name '*.db*' -exec cp -a {} "${RELEASE}/" \;
chown -R worker:worker "${RELEASE}"

cd "${RELEASE}"
"${PYTHON}" -m py_compile worker_supabase.py job_leases.py agents/*.py universe/*.py
set -a
# shellcheck disable=SC1091
source ./.env
set +a
"${PYTHON}" -c 'import worker_supabase; import agents.agentic_gap_fill; import agents.data_extractor; import agents.structured_lanes; print("staging release imports OK")'
"${PYTHON}" -c 'from contracts.signal_ontology import load_signal_ontology; from contracts.source_registry import load_source_registry; assert len(load_signal_ontology()["signals"]) >= 35; assert len(load_source_registry()) >= 10; print("staging local contracts OK")'
"${PYTHON}" -c 'from test_commercial_lifecycle import test_publication_gate_requires_budget_and_why_now_and_causal_plan as a, test_explicit_or_signal_policy_accepts_one_verified_signal_but_and_requires_all as b; a(); b(); print("staging high-value gate tests OK")'

ACTIVATION_STARTED=1
systemctl stop "${API_SERVICE}" "${WORKER_SERVICE}"
systemctl disable "${WORKER_SERVICE}" 2>/dev/null || true
mv "${CURRENT}" "${BACKUP}"
mv "${RELEASE}" "${CURRENT}"
systemctl start "${API_SERVICE}"
sleep 3
systemctl is-active --quiet "${API_SERVICE}"
test "$(systemctl is-active "${WORKER_SERVICE}" 2>/dev/null || true)" != "active"
test "$(systemctl is-enabled "${WORKER_SERVICE}" 2>/dev/null || true)" != "enabled"
curl -sf --max-time 10 http://127.0.0.1:8002/health

ACTIVATION_STARTED=0
rm -f "${ARCHIVE}"
trap - ERR
echo
echo "staging release ${RELEASE_ID} active; backup=${BACKUP}; worker=inactive+disabled"
