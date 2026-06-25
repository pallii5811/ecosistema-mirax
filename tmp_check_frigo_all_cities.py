import os,json
from supabase import create_client
sb=create_client('https://rtjmnjromqpsfqsgyfvp.supabase.co', os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp')
rows=sb.table('searches').select('id,status,category,location,results,created_at,user_id').ilike('category','%celle frigorifere industriali%').order('created_at', desc=True).limit(30).execute().data or []
print('ROWS',len(rows))
for r in rows:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    tech=sum(1 for x in arr if isinstance(x,dict) and isinstance(x.get('technical_report'),dict) and x.get('technical_report'))
    print(json.dumps({'id':r['id'],'status':r['status'],'category':r['category'],'location':r['location'],'created_at':r['created_at'],'count':len(arr),'tech':tech,'user_id':r.get('user_id')}, ensure_ascii=False))
