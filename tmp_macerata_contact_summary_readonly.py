import os,json,re
from supabase import create_client
sb=create_client('https://rtjmnjromqpsfqsgyfvp.supabase.co', os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp')
rows=sb.table('searches').select('id,status,category,location,results,created_at').ilike('category','%celle frigorifere industriali%').ilike('location','%Macerata%').order('created_at', desc=True).limit(3).execute().data or []
for r in rows:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    fake=sum(1 for x in arr if isinstance(x,dict) and any(bad in str(x.get('email') or '').lower() for bad in ['company.com','ninjamailtrap','mailtrap','example.com']))
    phones=sum(1 for x in arr if isinstance(x,dict) and len(re.sub(r'\D+','',str(x.get('telefono') or x.get('phone') or '')))>=8)
    emails=sum(1 for x in arr if isinstance(x,dict) and '@' in str(x.get('email') or '') and not any(bad in str(x.get('email') or '').lower() for bad in ['company.com','ninjamailtrap','mailtrap','example.com']))
    tech=sum(1 for x in arr if isinstance(x,dict) and isinstance(x.get('technical_report'),dict) and x.get('technical_report'))
    print(json.dumps({'id':r['id'],'status':r['status'],'created_at':r['created_at'],'count':len(arr),'phones':phones,'emails':emails,'fake_emails':fake,'tech':tech}, ensure_ascii=False))
    for x in arr[:12]:
        if isinstance(x,dict): print('LEAD', json.dumps({'name':x.get('azienda') or x.get('nome'),'site':x.get('sito') or x.get('website'),'phone':x.get('telefono') or x.get('phone'),'email':x.get('email')}, ensure_ascii=False))
