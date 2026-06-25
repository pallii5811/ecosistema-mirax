from pathlib import Path
from datetime import datetime

p=Path('/home/worker/app/backend/worker_supabase.py')
s=p.read_text(encoding='utf-8')
backup=p.with_suffix('.py.bak_organic_db_seed_order_'+datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')
old='''                seed_rows = _seed_sb.table("searches").select("results, category, location, created_at").eq("status", "completed").ilike("location", f"%{location}%").limit(80).execute().data or []
'''
new='''                seed_rows = _seed_sb.table("searches").select("results, category, location, created_at").eq("status", "completed").ilike("location", f"%{location}%").order("created_at", desc=True).limit(200).execute().data or []
'''
if old not in s:
    raise SystemExit('seed order anchor not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('patched',p)
print('backup',backup)
