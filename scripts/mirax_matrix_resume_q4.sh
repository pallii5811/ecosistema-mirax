#!/usr/bin/env bash
set -euo pipefail
STAGING=/home/worker/app/backend-staging
cp /tmp/mirax_patch_generic_web.py "$STAGING/source_adapters/generic_web.py"
/home/worker/app/venv/bin/python -m py_compile "$STAGING/source_adapters/generic_web.py"
echo GENERIC_WEB_PATCHED
# Resume Q4 same search if resumable, else note
/home/worker/app/venv/bin/python - <<'PY'
from dotenv import dotenv_values
from supabase import create_client
env=dotenv_values('/home/worker/app/backend-staging/.env')
sb=create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])
sid='c641ac2e-3cc7-4aa8-ae5c-cc0bef7987bd'
s=sb.table('searches').select('status,progress').eq('id',sid).single().execute().data
prog=s.get('progress') or {}
sr=prog.get('shadow_resume') or {}
print('q4_status', s.get('status'), 'resumable', sr.get('resumable'), 'cost', prog.get('cost_eur'), 'term', prog.get('termination_reason'))
if sr.get('resumable'):
    sb.table('searches').update({'status':'pending'}).eq('id',sid).execute()
    print('q4_requeued')
PY
