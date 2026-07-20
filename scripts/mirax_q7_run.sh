#!/bin/bash
set -euo pipefail
cd /home/worker/app/backend-staging
set -a; source .env; set +a
export PYTHONPATH=/home/worker/app/backend-staging
export MIRAX_WORKER_DISABLED=0 MIRAX_SEARCH_DISABLED=0
export MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED=1
export MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR=0.05
export MIRAX_ORCHESTRATOR_MAX_SECONDS=600

/home/worker/app/venv/bin/python /tmp/mirax_matrix_prepare_run.py q7 | head -2
SID=$(/home/worker/app/venv/bin/python -c "import json;print(json.load(open('/tmp/mirax_matrix_last_ids.json'))['search_id'])")
echo "SEARCH_ID=$SID"
for i in 1 2 3 4 5 6 7 8; do
  echo "==== PASS $i ===="
  /home/worker/app/venv/bin/python -u worker_supabase.py --once --search-id "$SID" --mode user --user-recent-minutes 0 --cooldown 0 || true
  OUT=$(/home/worker/app/venv/bin/python3 /tmp/mirax_gate_status.py "$SID")
  echo "$OUT"
  echo "$OUT" | /home/worker/app/venv/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if int(d.get("qualified") or 0)>=2 else 1)' && echo Q7_PASS && break
done
