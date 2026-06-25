from pathlib import Path
import json, os
backend = Path('/home/worker/app/backend')
for line in (backend / '.env').read_text(errors='ignore').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
from supabase import create_client
url=os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb=create_client(url,key)
res=sb.table('searches').select('*').order('created_at', desc=True).limit(3).execute().data or []
for r in res:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except Exception: arr=[]
    phones=sum(1 for x in arr if str(x.get('telefono') or x.get('phone') or '').strip() not in ('','N/D','N/A','None','null'))
    emails=sum(1 for x in arr if '@' in str(x.get('email') or ''))
    audited=sum(1 for x in arr if (x.get('technical_report') or {}).get('organic_audited'))
    org=sum(1 for x in arr if 'organic_website_discovery' in json.dumps(x.get('technical_report') or {}, ensure_ascii=False).lower())
    print(json.dumps({'id':r.get('id'),'status':r.get('status'),'category':r.get('category'),'location':r.get('location'),'count':len(arr),'organic':org,'audited':audited,'phones':phones,'emails':emails}, ensure_ascii=False))
    for x in arr[:20]:
        print('LEAD', x.get('azienda'), 'tel=', x.get('telefono'), 'email=', x.get('email'), 'audited=', (x.get('technical_report') or {}).get('organic_audited'), 'site=', x.get('sito'))
