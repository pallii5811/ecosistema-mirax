from pathlib import Path
p = Path('/home/worker/app/backend/worker_supabase.py')
s = p.read_text(encoding='utf-8')
start = s.find('def _filter_non_domestic_refrigeration_results')
end = s.find('\ndef ', start + 10)
print(s[start:end])
