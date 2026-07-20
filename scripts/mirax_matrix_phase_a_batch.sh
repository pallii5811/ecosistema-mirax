#!/usr/bin/env bash
set -euo pipefail
sleep 200
echo "====Q7===="
/home/worker/app/venv/bin/python /tmp/mirax_matrix_poll.py a1116b3a-a60a-450c-a5bc-2fef3d26e319
/home/worker/app/venv/bin/python /tmp/mirax_matrix_deep_poll.py a1116b3a-a60a-450c-a5bc-2fef3d26e319
echo "====Q2===="
/home/worker/app/venv/bin/python -u /tmp/mirax_matrix_prepare_run.py q2 | tee /tmp/mirax_matrix_q2d.log | tail -n 5
SID=$(/home/worker/app/venv/bin/python -c 'import json;print(json.load(open("/tmp/mirax_matrix_last_ids.json"))["search_id"])')
echo "Q2_SID=$SID"
/home/worker/app/venv/bin/python /tmp/mirax_matrix_poll.py "$SID"
/home/worker/app/venv/bin/python /tmp/mirax_matrix_deep_poll.py "$SID"
echo "====Q4===="
/home/worker/app/venv/bin/python -u /tmp/mirax_matrix_prepare_run.py q4 | tee /tmp/mirax_matrix_q4f.log | tail -n 5
SID4=$(/home/worker/app/venv/bin/python -c 'import json;print(json.load(open("/tmp/mirax_matrix_last_ids.json"))["search_id"])')
echo "Q4_SID=$SID4"
/home/worker/app/venv/bin/python /tmp/mirax_matrix_poll.py "$SID4"
/home/worker/app/venv/bin/python /tmp/mirax_matrix_deep_poll.py "$SID4"
