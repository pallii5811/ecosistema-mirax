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
def has_phone(x):
    phone=str(x.get('telefono') or x.get('phone') or '').strip()
    return phone not in BAD and len(re.sub(r'\D+','',phone))>=8
def has_any_contact(x):
    email=str(x.get('email') or '').strip()
    return has_phone(x) or ('@' in email and email not in BAD)
def is_org(x):
    blob=json.dumps({'tr':x.get('technical_report'),'stack':x.get('tech_stack'),'source':x.get('source')}, ensure_ascii=False).lower()
    return 'organic_website_discovery' in blob or 'lead da sito web' in blob or 'contatto da verificare' in blob
rows=sb.table('searches').select('*').order('created_at', desc=True).limit(10).execute().data or []
for r in rows:
    cat=str(r.get('category') or '').lower(); loc=str(r.get('location') or '').lower()
    if not (('frigor' in cat or 'refriger' in cat or 'celle' in cat) and 'milan' in loc): continue
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except Exception: arr=[]
    if not isinstance(arr,list): arr=[]
    before=len(arr); org_before=sum(1 for x in arr if is_org(x))
    clean=[]; removed_org_no_phone=0; removed_maps_no_contact=0
    seen=set()
    for x in arr:
        org=is_org(x)
        if org and not has_phone(x):
            removed_org_no_phone += 1
            continue
        if not org and not has_any_contact(x):
            removed_maps_no_contact += 1
            continue
        site=str(x.get('sito') or x.get('website') or '').lower().replace('https://','').replace('http://','').replace('www.','').rstrip('/')
        phone=re.sub(r'\D+','',str(x.get('telefono') or x.get('phone') or ''))[-9:]
        key=site or phone or str(x.get('azienda') or x.get('nome') or '').lower()
        if key in seen: continue
        seen.add(key); clean.append(x)
    clean=w._filter_non_domestic_refrigeration_results(str(r.get('category') or ''), clean)
    sb.table('searches').update({'results': clean}).eq('id', r.get('id')).execute()
    print(json.dumps({'id':r.get('id'),'before':before,'after':len(clean),'organic_before':org_before,'organic_after':sum(1 for x in clean if is_org(x)),'removed_org_no_phone':removed_org_no_phone,'removed_maps_no_contact':removed_maps_no_contact,'phones':sum(1 for x in clean if has_phone(x)),'emails':sum(1 for x in clean if '@' in str(x.get('email') or ''))}, ensure_ascii=False))
    for x in clean[:20]: print('LEAD', x.get('azienda'), x.get('telefono') or x.get('phone'), x.get('email'), 'ORG' if is_org(x) else 'MAPS')
