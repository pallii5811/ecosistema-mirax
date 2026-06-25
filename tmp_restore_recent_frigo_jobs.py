from pathlib import Path
import json, os, re, sys
sys.path.insert(0, '/home/worker/app')
sys.path.insert(0, '/home/worker/app/backend')
backend=Path('/home/worker/app/backend')
for line in (backend/'.env').read_text(errors='ignore').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
from supabase import create_client
import backend.worker_supabase as w
url=os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb=create_client(url,key)
BAD={'','N/D','N/A','N.D.','None','none','null','-','—'}
def has_contact(x):
    phone=str(x.get('telefono') or x.get('phone') or '').strip()
    email=str(x.get('email') or '').strip()
    return (phone not in BAD and len(re.sub(r'\D+','',phone))>=8) or ('@' in email and email not in BAD)
def is_org(x):
    blob=json.dumps({'tr':x.get('technical_report'),'stack':x.get('tech_stack'),'source':x.get('source')}, ensure_ascii=False).lower()
    return 'organic_website_discovery' in blob or 'lead da sito web' in blob or 'contatto da verificare' in blob
rows=sb.table('searches').select('*').order('created_at', desc=True).limit(12).execute().data or []
frigo=[]
for r in rows:
    cat=str(r.get('category') or '').lower(); loc=str(r.get('location') or '').lower()
    if ('frigor' in cat or 'refriger' in cat or 'celle' in cat) and 'milan' in loc:
        arr=r.get('results') or []
        if isinstance(arr,str):
            try: arr=json.loads(arr)
            except Exception: arr=[]
        if isinstance(arr,list) and arr:
            frigo.append((r,arr))
pool=[]
for r,arr in frigo:
    pool.extend(arr)
# Keep all Maps with contact, keep organic only with contact. Let safe filter remove domestic.
clean=[]
seen=set()
for x in pool:
    if is_org(x) and not has_contact(x):
        continue
    if not is_org(x) and not has_contact(x):
        continue
    site=str(x.get('sito') or x.get('website') or '').lower().replace('https://','').replace('http://','').replace('www.','').rstrip('/')
    phone=re.sub(r'\D+','',str(x.get('telefono') or x.get('phone') or ''))[-9:]
    email=str(x.get('email') or '').lower().strip()
    key=site or phone or email or str(x.get('azienda') or x.get('nome') or '').lower()
    if key in seen: continue
    seen.add(key); clean.append(x)
clean=w._filter_non_domestic_refrigeration_results('celle frigorifere industriali', clean)
for r,arr in frigo[:3]:
    sb.table('searches').update({'results': clean, 'status': 'completed'}).eq('id', r.get('id')).execute()
    print(json.dumps({'updated':r.get('id'), 'count':len(clean), 'phones':sum(1 for x in clean if has_contact({'telefono':x.get('telefono') or x.get('phone')})), 'emails':sum(1 for x in clean if '@' in str(x.get('email') or '')), 'organic':sum(1 for x in clean if is_org(x))}, ensure_ascii=False))
for x in clean[:30]: print('LEAD', x.get('azienda'), x.get('telefono') or x.get('phone'), x.get('email'), x.get('sito') or x.get('website'))
