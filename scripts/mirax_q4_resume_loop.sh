#!/usr/bin/env bash
set -euo pipefail
set -a; source /home/worker/app/backend-staging/.env; set +a
SID="${1:?search id}"
cd /home/worker/app/backend-staging
export MIRAX_WORKER_DISABLED=0 MIRAX_SEARCH_DISABLED=0 MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED=1
export MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR=0.05 MIRAX_ORCHESTRATOR_MAX_SECONDS=600 MIRAX_ORCHESTRATOR_MAX_ROUNDS=120
export PYTHONPATH=/home/worker/app:/home/worker/app/backend-staging
for i in $(seq 1 8); do
  echo "=== RESUME $i ==="
  /home/worker/app/venv/bin/python3 -u worker_supabase.py --once --search-id "$SID" --mode user --user-recent-minutes 0 --cooldown 0 2>&1 | tail -5
  /home/worker/app/venv/bin/python3 /tmp/mirax_gate_status.py "$SID"
  Q=$(/home/worker/app/venv/bin/python3 -c "import os; from supabase import create_client; sb=create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY']); p=sb.table('searches').select('status,progress').eq('id','${SID}').single().execute().data; pr=p['progress']; print(int(pr.get('lifecycle_qualified') or pr.get('qualified') or 0))")
  ST=$(/home/worker/app/venv/bin/python3 -c "import os; from supabase import create_client; sb=create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY']); print(sb.table('searches').select('status').eq('id','${SID}').single().execute().data['status'])")
  echo "lifecycle=$Q status=$ST"
  if [ "$Q" -ge 2 ] && [ "$ST" = "completed" ]; then echo Q4_PASS; exit 0; fi
done
exit 1
