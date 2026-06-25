import os,json
from supabase import create_client
sb=create_client('https://rtjmnjromqpsfqsgyfvp.supabase.co', os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp')
for job_id in ['0b286e77-70b8-4af2-869f-6b6a00261477','c415acd0-af22-4f0c-8c44-d385c038936c']:
    r=sb.table('searches').select('id,status,category,location,results,created_at').eq('id',job_id).single().execute().data or {}
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    tech=sum(1 for x in arr if isinstance(x,dict) and isinstance(x.get('technical_report'),dict) and x.get('technical_report'))
    emails=sum(1 for x in arr if isinstance(x,dict) and '@' in str(x.get('email') or ''))
    phones=sum(1 for x in arr if isinstance(x,dict) and len(''.join(ch for ch in str(x.get('telefono') or x.get('phone') or '') if ch.isdigit()))>=8)
    print(json.dumps({'id':job_id,'status':r.get('status'),'created_at':r.get('created_at'),'count':len(arr),'tech_report':tech,'phones':phones,'emails':emails}, ensure_ascii=False))
