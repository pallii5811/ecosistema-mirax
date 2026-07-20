#!/usr/bin/env bash
set -euo pipefail
STAGING=/home/worker/app/backend-staging
# Hot-patch matrix runtime files (do not touch hiring_semantic_bridge / S1 freeze surface)
cp -a "$STAGING/source_adapters/generic_web.py" /tmp/generic_web.py.bak.$(date +%s) || true
cp -a "$STAGING/worker_supabase.py" /tmp/worker_supabase.py.bak.$(date +%s) || true
cp -a "$STAGING/source_adapters/orchestrator.py" /tmp/orchestrator.py.bak.$(date +%s) || true
cp /tmp/mirax_patch_generic_web.py "$STAGING/source_adapters/generic_web.py"
cp /tmp/mirax_patch_worker_supabase.py "$STAGING/worker_supabase.py"
cp /tmp/mirax_patch_orchestrator.py "$STAGING/source_adapters/orchestrator.py"
# Sentinel (new file only)
cp /tmp/mirax_patch_s1_sentinel.py "$STAGING/test_s1_regression_sentinel.py"
/home/worker/app/venv/bin/python -m py_compile \
  "$STAGING/source_adapters/generic_web.py" \
  "$STAGING/worker_supabase.py" \
  "$STAGING/source_adapters/orchestrator.py" \
  "$STAGING/test_s1_regression_sentinel.py"
echo PATCH_OK
# Restart staging API so worker_supabase import path matches oneshot cwd
systemctl restart mirax-staging-api 2>/dev/null || systemctl restart mirax-api-staging 2>/dev/null || true
sleep 2
ss -ltnp | grep 8002 || true
