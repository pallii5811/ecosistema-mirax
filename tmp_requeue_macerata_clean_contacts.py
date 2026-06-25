import os,json,re
from datetime import datetime, timezone
from supabase import create_client
sb=create_client('https://rtjmnjromqpsfqsgyfvp.supabase.co', os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp')
rows=sb.table('searches').select('id,status,category,location,results,created_at,user_id').ilike('category','%celle frigorifere industriali%').ilike('location','%Macerata%').order('created_at', desc=True).limit(5).execute().data or []
print('ROWS',len(rows))
def arr(row):
    x=row.get('results') or []
    if isinstance(x,str):
        try:x=json.loads(x)
        except:x=[]
    return x if isinstance(x,list) else []
for r in rows:
    a=arr(r)
    fake=sum(1 for x in a if isinstance(x,dict) and any(bad in str(x.get('email') or '').lower() for bad in ['company.com','ninjamailtrap','mailtrap','example.com']))
    phones=sum(1 for x in a if isinstance(x,dict) and len(re.sub(r'\D+','',str(x.get('telefono') or x.get('phone') or '')))>=8)
    print('JOB',json.dumps({'id':r['id'],'status':r['status'],'created_at':r['created_at'],'count':len(a),'phones':phones,'fake_emails':fake},ensure_ascii=False))
if rows:
    job=rows[0]
    a=arr(job)
    now=datetime.now(timezone.utc).isoformat()
    sb.table('searches').update({'status':'pending','created_at':now,'results':a}).eq('id', job['id']).execute()
    print('REQUEUED',json.dumps({'id':job['id'],'count':len(a),'created_at':now},ensure_ascii=False))
