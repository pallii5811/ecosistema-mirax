from pathlib import Path
from datetime import datetime

p = Path('/home/worker/app/backend/worker_supabase.py')
s = p.read_text(encoding='utf-8')
backup = p.with_suffix('.py.bak_preserve_existing_results_' + datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')

old = '''            # Real-time result callback: push each result to DB as it's found
            _rt_results = []
            _rt_lock = __import__('threading').Lock()
'''
new = '''            # Real-time result callback: push each result to DB as it's found
            _rt_results = []
            try:
                existing_results = job.get("results") if isinstance(job, dict) else None
                if isinstance(existing_results, str):
                    try:
                        existing_results = json.loads(existing_results)
                    except Exception:
                        existing_results = []
                if isinstance(existing_results, list):
                    _rt_results = _filter_non_domestic_refrigeration_results(category, _merge_formatted_results([], existing_results))
                    if _rt_results:
                        print(f"[worker_supabase] Preserved existing results before re-scrape: {len(_rt_results)}", flush=True)
            except Exception as e:
                print(f"[worker_supabase] Preserve existing results skipped: {e}", flush=True)
                _rt_results = []
            _rt_lock = __import__('threading').Lock()
'''
if old not in s:
    raise SystemExit('anchor not found for _rt_results init')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('patched=', p)
print('backup=', backup)
