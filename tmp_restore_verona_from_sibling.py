import os, json
from datetime import datetime, timezone
from supabase import create_client
SUPABASE_URL='https://rtjmnjromqpsfqsgyfvp.supabase.co'
key=os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp'
sb=create_client(SUPABASE_URL,key)
source_id='c415acd0-af22-4f0c-8c44-d385c038936c'
target_id='0b286e77-70b8-4af2-869f-6b6a00261477'
src=sb.table('searches').select('results,category,location,status,created_at').eq('id',source_id).single().execute().data or {}
tgt=sb.table('searches').select('results,category,location,status,created_at').eq('id',target_id).single().execute().data or {}
def arr(row):
    x=row.get('results') or []
    if isinstance(x,str):
        try: x=json.loads(x)
        except: x=[]
    return x if isinstance(x,list) else []
src_arr=arr(src); tgt_arr=arr(tgt)
restore=src_arr if len(src_arr)>=len(tgt_arr) else tgt_arr
now=datetime.now(timezone.utc).isoformat()
print('BEFORE', json.dumps({'source_count':len(src_arr),'source_status':src.get('status'),'target_count':len(tgt_arr),'target_status':tgt.get('status')}, ensure_ascii=False))
sb.table('searches').update({'status':'pending','created_at':now,'results':restore}).eq('id',target_id).execute()
print('AFTER', json.dumps({'target_id':target_id,'status':'pending','created_at':now,'count':len(restore)}, ensure_ascii=False))
