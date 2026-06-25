import os, json
from datetime import datetime
from supabase import create_client

SUPABASE_URL='https://rtjmnjromqpsfqsgyfvp.supabase.co'
key=os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp'
sb=create_client(SUPABASE_URL,key)
rows=sb.table('searches').select('id,status,category,location,results,created_at,user_id').ilike('category','%frigor%').ilike('location','%Milano%').order('created_at', desc=True).limit(20).execute().data or []
print('ROWS',len(rows))
for r in rows:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    organic=0; maps=0; phones=0; emails=0
    for x in arr:
        blob=json.dumps({k:x.get(k) for k in ['source','technical_report','tech_stack']}, ensure_ascii=False).lower() if isinstance(x,dict) else ''
        is_org='organic_website_discovery' in blob or 'lead da sito web' in blob
        organic += 1 if is_org else 0
        maps += 0 if is_org else 1
        phone=str(x.get('telefono') or x.get('phone') or '') if isinstance(x,dict) else ''
        email=str(x.get('email') or '') if isinstance(x,dict) else ''
        phones += 1 if len(''.join(ch for ch in phone if ch.isdigit()))>=8 else 0
        emails += 1 if '@' in email else 0
    print(json.dumps({'id':r.get('id'),'status':r.get('status'),'created_at':r.get('created_at'),'category':r.get('category'),'location':r.get('location'),'count':len(arr),'organic':organic,'maps':maps,'phones':phones,'emails':emails,'user_id':r.get('user_id')}, ensure_ascii=False))
