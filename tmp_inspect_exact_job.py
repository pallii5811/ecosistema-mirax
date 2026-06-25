from pathlib import Path
import json, os, re
backend = Path('/home/worker/app/backend')
for line in (backend/'.env').read_text(errors='ignore').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
from supabase import create_client
url=os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb=create_client(url,key)
job_id='c1c04ffb-bf73-4c1a-9031-de352481e54f'
r=sb.table('searches').select('*').eq('id', job_id).single().execute().data
arr=r.get('results') or []
if isinstance(arr,str):
    try: arr=json.loads(arr)
    except Exception: arr=[]
print('JOB', json.dumps({k:r.get(k) for k in ['id','status','created_at','updated_at','category','location','error','error_message']}, ensure_ascii=False, default=str))
print('COUNT', len(arr))
for i,x in enumerate(arr):
    blob=json.dumps({'tr':x.get('technical_report'),'stack':x.get('tech_stack'),'source':x.get('source')}, ensure_ascii=False).lower()
    is_org='organic_website_discovery' in blob or 'lead da sito web' in blob or 'contatto da verificare' in blob
    phone=str(x.get('telefono') or x.get('phone') or '')
    print(i, 'ORG' if is_org else 'MAPS', 'phone=', phone, 'email=', x.get('email'), 'name=', x.get('azienda') or x.get('business_name'), 'site=', x.get('sito') or x.get('website'), 'tr=', x.get('technical_report'))

s=Path('/home/worker/app/backend/worker_supabase.py').read_text(encoding='utf-8')
for token in ['def _publish_progressive_organic', 'def _has_real_contact', 'def _has_contact(item: Dict[str, Any])', 'Organic website discovery final merge']:
    i=s.find(token); print('\nTOKEN', token, 'idx', i)
    if i>=0: print(s[i:i+1800])
