import os, json
from supabase import create_client
SUPABASE_URL='https://rtjmnjromqpsfqsgyfvp.supabase.co'
key=os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp'
sb=create_client(SUPABASE_URL,key)
rows=sb.table('searches').select('*').eq('status','error').order('created_at', desc=True).limit(20).execute().data or []
print('ERROR_ROWS', len(rows))
for r in rows:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    keys={k:r.get(k) for k in ['id','status','category','location','created_at','updated_at','error','error_message','message','note','user_id'] if k in r}
    keys['count']=len(arr)
    print(json.dumps(keys, ensure_ascii=False, default=str))
    for x in arr[:3]:
        if isinstance(x,dict): print(' SAMPLE', json.dumps({'name':x.get('azienda') or x.get('nome'),'site':x.get('sito') or x.get('website'),'phone':x.get('telefono') or x.get('phone'),'email':x.get('email')}, ensure_ascii=False))
