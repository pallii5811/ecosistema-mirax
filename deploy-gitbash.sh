#!/usr/bin/env bash
# MIRAX — deploy Git (Git Bash / WSL). Evita problemi PowerShell con && e heredoc.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> npm run build"
npm run build

if git diff --quiet && git diff --cached --quiet; then
  echo "==> Nessuna modifica da committare"
else
  git add -A
  git commit -m "feat: MIRAX v4.0 — $(date +%Y-%m-%d)"
fi

echo "==> git push origin main"
git push origin main
echo "==> Deploy Git completato"
