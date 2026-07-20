#!/bin/bash
set -euo pipefail
cd /home/worker/app/backend-staging
set -a; source .env; set +a
export PYTHONPATH=/home/worker/app/backend-staging
export MIRAX_WORKER_DISABLED=0 MIRAX_SEARCH_DISABLED=0
export MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED=1
export MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR=0.05
export MIRAX_ORCHESTRATOR_MAX_SECONDS=300

/home/worker/app/venv/bin/python /tmp/mirax_matrix_prepare_run.py q7 | head -2
SID=$(python3 -c "import json;print(json.load(open('/tmp/mirax_matrix_last_ids.json'))['search_id'])")
echo "SEARCH_ID=$SID"
for i in 1 2 3 4 5; do
  /home/worker/app/venv/bin/python -u worker_supabase.py --once --search-id "$SID" --mode user --user-recent-minutes 0 --cooldown 0 || true
  /home/worker/app/venv/bin/python3 /tmp/mirax_gate_status.py "$SID"
done
