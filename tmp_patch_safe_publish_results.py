from pathlib import Path
from datetime import datetime

p=Path('/home/worker/app/backend/worker_supabase.py')
s=p.read_text(encoding='utf-8')
backup=p.with_suffix('.py.bak_safe_publish_results_'+datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')

anchor='''            _rt_lock = __import__('threading').Lock()

            def _publish_progressive_organic():
'''
helper='''            _rt_lock = __import__('threading').Lock()

            def _load_current_job_results_safe():
                try:
                    row = supabase.table("searches").select("results").eq("id", job_id).single().execute().data or {}
                    current = row.get("results") or []
                    if isinstance(current, str):
                        try:
                            current = json.loads(current)
                        except Exception:
                            current = []
                    return current if isinstance(current, list) else []
                except Exception:
                    return []

            def _publish_job_results_safe(new_results, status=None):
                try:
                    current = _load_current_job_results_safe()
                    merged = _merge_formatted_results(current, new_results if isinstance(new_results, list) else [])
                    merged = _filter_non_domestic_refrigeration_results(category, merged)
                    with _rt_lock:
                        _rt_results.clear()
                        _rt_results.extend(merged)
                    payload = {"results": merged}
                    if status:
                        payload["status"] = status
                    supabase.table("searches").update(payload).eq("id", job_id).execute()
                    return merged
                except Exception as e:
                    print(f"[worker_supabase] Safe publish skipped: {e}", flush=True)
                    return new_results if isinstance(new_results, list) else []

            def _publish_progressive_organic():
'''
if anchor not in s:
    raise SystemExit('helper anchor not found')
s=s.replace(anchor, helper, 1)
s=s.replace('''                        supabase.table("searches").update({"results": snapshot}).eq("id", job_id).execute()
                        published += 1
                        print(f"[worker_supabase] Progressive organic audit published: {enriched.get('azienda') or enriched.get('sito')} contact=True total={len(snapshot)}", flush=True)
''','''                        snapshot = _publish_job_results_safe(snapshot)
                        published += 1
                        print(f"[worker_supabase] Progressive organic audit published: {enriched.get('azienda') or enriched.get('sito')} contact=True total={len(snapshot)}", flush=True)
''',1)
s=s.replace('''                        supabase.table("searches").update({"results": snapshot}).eq("id", job_id).execute()
                except Exception:
                    pass
''','''                        _publish_job_results_safe(snapshot)
                except Exception:
                    pass
''',1)
s=s.replace('''                        supabase.table("searches").update({"results": snapshot}).eq("id", job_id).execute()
                except Exception:
                    pass
''','''                        _publish_job_results_safe(snapshot)
                except Exception:
                    pass
''',1)
s=s.replace('''            supabase.table("searches").update(
                {
                    "status": "completed",
                    "results": formatted,
                }
            ).eq("id", job_id).execute()
''','''            formatted = _publish_job_results_safe(formatted, status="completed")
''',1)
p.write_text(s, encoding='utf-8')
print('patched', p)
print('backup', backup)
