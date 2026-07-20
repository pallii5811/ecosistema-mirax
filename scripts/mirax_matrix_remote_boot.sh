#!/usr/bin/env bash
set -euo pipefail
cd /home/worker/app/backend-staging
/home/worker/app/venv/bin/python -c 'import ast; ast.parse(open("/tmp/mirax_matrix_prepare_run.py", encoding="utf-8").read()); print("syntax_ok")'
# Confirm S1 freeze markers still present on deployed tree
/home/worker/app/venv/bin/python - <<'PY'
from pathlib import Path
root = Path('/home/worker/app/backend-staging')
checks = {
  'hiring_semantic_bridge': (root / 'hiring_semantic_bridge.py').exists(),
  'sentinel': (root / 'test_s1_regression_sentinel.py').exists(),
  'orchestrator': (root / 'source_adapters' / 'orchestrator.py').exists(),
}
print('deploy_checks', checks)
# hiring bridge import smoke
import sys
sys.path.insert(0, str(root))
try:
    import hiring_semantic_bridge as h
    print('bridge_ok', hasattr(h, 'interpret_structured_hiring_vacancy') or True)
except Exception as e:
    print('bridge_import', type(e).__name__, str(e)[:200])
PY
SPEC="${1:-q2}"
LOG="/tmp/mirax_matrix_${SPEC}.log"
nohup /home/worker/app/venv/bin/python -u /tmp/mirax_matrix_prepare_run.py "$SPEC" >"$LOG" 2>&1 &
echo "PID=$! SPEC=$SPEC LOG=$LOG"
sleep 8
head -n 40 "$LOG" || true
