from pathlib import Path
import json, os
backend=Path('/home/worker/app/backend')
for line in (backend/'.env').read_text(errors='ignore').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
from supabase import create_client
url=os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb=create_client(url,key)
job_id='c1c04ffb-bf73-4c1a-9031-de352481e54f'
r=sb.table('searches').select('id,status,created_at,category,location,results').eq('id',job_id).single().execute().data
arr=r.get('results') or []
if isinstance(arr,str):
    try: arr=json.loads(arr)
    except Exception: arr=[]
print('BEFORE', json.dumps({'id':r.get('id'),'status':r.get('status'),'count':len(arr),'category':r.get('category'),'location':r.get('location')}, ensure_ascii=False))
sb.table('searches').update({'status':'pending'}).eq('id',job_id).execute()
r2=sb.table('searches').select('id,status,results').eq('id',job_id).single().execute().data
arr2=r2.get('results') or []
if isinstance(arr2,str):
    try: arr2=json.loads(arr2)
    except Exception: arr2=[]
print('AFTER', json.dumps({'id':r2.get('id'),'status':r2.get('status'),'count':len(arr2)}, ensure_ascii=False))
