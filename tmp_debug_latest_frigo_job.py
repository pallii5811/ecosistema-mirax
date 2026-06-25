from pathlib import Path
import json, os, re
backend = Path('/home/worker/app/backend')
for line in (backend / '.env').read_text(errors='ignore').splitlines():
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
def has_email(x): return '@' in str(x.get('email') or '')
def is_org(x):
    blob=json.dumps({'tr':x.get('technical_report'),'stack':x.get('tech_stack'),'source':x.get('source')}, ensure_ascii=False).lower()
    return 'organic_website_discovery' in blob or 'lead da sito web' in blob or 'contatto da verificare' in blob
rows=sb.table('searches').select('*').order('created_at', desc=True).limit(12).execute().data or []
for r in rows:
    cat=str(r.get('category') or '')
    loc=str(r.get('location') or '')
    if not (('frigor' in cat.lower() or 'refriger' in cat.lower() or 'celle' in cat.lower()) and 'milan' in loc.lower()):
        continue
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except Exception: arr=[]
    if not isinstance(arr,list): arr=[]
    print(json.dumps({'id':r.get('id'),'status':r.get('status'),'created_at':r.get('created_at'),'category':cat,'location':loc,'count':len(arr),'organic':sum(1 for x in arr if is_org(x)),'maps':sum(1 for x in arr if not is_org(x)),'phones':sum(1 for x in arr if has_phone(x)),'emails':sum(1 for x in arr if has_email(x))}, ensure_ascii=False))
    for x in arr[:30]:
        print('LEAD', 'ORG' if is_org(x) else 'MAPS', x.get('azienda'), 'tel=', x.get('telefono') or x.get('phone'), 'email=', x.get('email'), 'site=', x.get('sito') or x.get('website'))
