import os, json
from datetime import datetime, timezone
from supabase import create_client
SUPABASE_URL='https://rtjmnjromqpsfqsgyfvp.supabase.co'
key=os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp'
sb=create_client(SUPABASE_URL,key)
rows=sb.table('searches').select('id,status,category,location,results,created_at,user_id').or_('category.ilike.%consulenza%,category.ilike.%aziendale%').ilike('location','%Verona%').order('created_at', desc=True).limit(5).execute().data or []
print('ROWS', len(rows))
for r in rows:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    tech=sum(1 for x in arr if isinstance(x,dict) and isinstance(x.get('technical_report'),dict) and x.get('technical_report'))
    print('JOB', json.dumps({'id':r.get('id'),'status':r.get('status'),'created_at':r.get('created_at'),'category':r.get('category'),'location':r.get('location'),'count':len(arr),'tech':tech}, ensure_ascii=False))

if rows:
    job=rows[0]
    arr=job.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    now=datetime.now(timezone.utc).isoformat()
    resp=sb.table('searches').update({'status':'pending','created_at':now,'results':arr}).eq('id', job['id']).execute()
    print('REQUEUED', json.dumps({'id':job['id'],'created_at':now,'count':len(arr)}, ensure_ascii=False))
