from pathlib import Path
import json, os, re
backend=Path('/home/worker/app/backend')
for line in (backend/'.env').read_text(errors='ignore').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
from supabase import create_client
url=os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb=create_client(url,key)
BAD={'','N/D','N/A','N.D.','None','none','null','-','—'}
def has_phone(x):
    phone=str(x.get('telefono') or x.get('phone') or '').strip()
    return phone not in BAD and len(re.sub(r'\D+','',phone))>=8
def has_email(x):
    email=str(x.get('email') or '').strip()
    return '@' in email and email not in BAD
def is_org(x):
    blob=json.dumps({'tr':x.get('technical_report'),'stack':x.get('tech_stack'),'source':x.get('source')}, ensure_ascii=False).lower()
    return 'organic_website_discovery' in blob or 'lead da sito web' in blob or 'contatto da verificare' in blob
print('=== RECENT FRIGO SEARCHES ===')
rows=sb.table('searches').select('*').order('created_at', desc=True).limit(30).execute().data or []
for r in rows:
    cat=str(r.get('category') or '')
    loc=str(r.get('location') or '')
    if not (('frigor' in cat.lower() or 'refriger' in cat.lower() or 'celle' in cat.lower()) and 'milan' in loc.lower()): continue
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except Exception: arr=[]
    if not isinstance(arr,list): arr=[]
    print(json.dumps({'id':r.get('id'),'status':r.get('status'),'created_at':r.get('created_at'),'updated_at':r.get('updated_at'),'category':cat,'location':loc,'count':len(arr),'organic':sum(1 for x in arr if is_org(x)),'maps':sum(1 for x in arr if not is_org(x)),'phones':sum(1 for x in arr if has_phone(x)),'emails':sum(1 for x in arr if has_email(x)),'error':r.get('error') or r.get('error_message')}, ensure_ascii=False, default=str))
    for x in arr[:25]:
        print('  ', 'ORG' if is_org(x) else 'MAPS', '| phone', bool(has_phone(x)), '| email', bool(has_email(x)), '|', (x.get('azienda') or x.get('business_name') or x.get('nome') or '')[:80], '|', x.get('telefono') or x.get('phone'), '|', x.get('email'), '|', x.get('sito') or x.get('website'))
print('=== BACKUPS ===')
for f in sorted(backend.glob('worker_supabase.py.bak*'), key=lambda p:p.stat().st_mtime, reverse=True)[:30]:
    print(f.name, f.stat().st_size, f.stat().st_mtime)
print('=== CURRENT FILTER MARKERS ===')
s=(backend/'worker_supabase.py').read_text(encoding='utf-8')
for token in ['SAFE industrial refrigeration filter','STRICT industrial refrigeration filter','Progressive organic discovery candidates','Organic website discovery final merge','def _has_real_contact','def _has_contact(item: Dict[str, Any])']:
    print(token, 'count=', s.count(token), 'idx=', s.find(token))
