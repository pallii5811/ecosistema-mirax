#!/usr/bin/env bash
# Blocco 9 — Deploy worker su STAGING (116:8002)
# Uso: ./backend_mirror/scripts/deploy-staging.sh [user@host]
set -euo pipefail

HOST="${1:-root@116.203.137.39}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_DIR="$(cd "${LOCAL_DIR}/.." && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="${TMPDIR:-/tmp}/mirax-staging-${TS}.tar.gz"
REMOTE_ARCHIVE="/tmp/mirax-staging-${TS}.tar.gz"
ACTIVATOR="${LOCAL_DIR}/scripts/activate-staging-release.sh"

echo "==> MIRAX deploy STAGING atomico -> ${HOST}"

cleanup() { rm -f "${ARCHIVE}"; }
trap cleanup EXIT

tar czf "${ARCHIVE}" \
  --exclude='.env*' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='data' \
  --exclude='*.db*' \
  -C "${LOCAL_DIR}" . \
  -C "${WORKSPACE_DIR}" contracts

if tar tzf "${ARCHIVE}" | grep -Eq '(^|/)\.env|__pycache__|\.db($|[-.])'; then
  echo "Archivio non sicuro: contiene runtime state o segreti" >&2
  exit 1
fi

tar tzf "${ARCHIVE}" | grep -q '^contracts/fixtures/commercial-search-plan.valid.json$'
tar tzf "${ARCHIVE}" | grep -q '^contracts/signal-ontology.v1.json$'
tar tzf "${ARCHIVE}" | grep -q '^contracts/source-registry.v1.json$'
tar tzf "${ARCHIVE}" | grep -q '^contracts/commercial-search-plan.schema.json$'

scp -o BatchMode=yes -o ConnectTimeout=15 "${ARCHIVE}" "${HOST}:${REMOTE_ARCHIVE}"
scp -o BatchMode=yes -o ConnectTimeout=15 "${ACTIVATOR}" "${HOST}:/tmp/activate-staging-release.sh"
ssh -o BatchMode=yes -o ConnectTimeout=15 "${HOST}" \
  "chmod 700 /tmp/activate-staging-release.sh && /tmp/activate-staging-release.sh '${REMOTE_ARCHIVE}' '${TS}'"

echo "==> Deploy staging completato: release ${TS}"
