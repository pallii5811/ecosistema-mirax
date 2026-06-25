import os, json
from supabase import create_client
SUPABASE_URL='https://rtjmnjromqpsfqsgyfvp.supabase.co'
key=os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp'
sb=create_client(SUPABASE_URL,key)
rows=sb.table('searches').select('id,status,category,location,results,created_at,error,user_id').or_('category.ilike.%consulenza%,category.ilike.%aziendale%').ilike('location','%Verona%').order('created_at', desc=True).limit(10).execute().data or []
print('ROWS',len(rows))
for r in rows:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    if not isinstance(arr,list): arr=[]
    audited=0; tech=0; pending=0; organic=0
    samples=[]
    for x in arr:
        if not isinstance(x,dict): continue
        tr=x.get('technical_report') if isinstance(x.get('technical_report'),dict) else {}
        au=x.get('audit') if isinstance(x.get('audit'),dict) else {}
        if tr: tech+=1
        if au or tr.get('organic_audited') or tr.get('status') or tr.get('seo_errors') is not None: audited+=1
        else: pending+=1
        blob=json.dumps({k:x.get(k) for k in ['source','technical_report','tech_stack']}, ensure_ascii=False).lower()
        if 'organic_website_discovery' in blob or 'lead da sito web' in blob: organic+=1
        if len(samples)<8:
            samples.append({'name':x.get('azienda') or x.get('nome'),'site':x.get('sito') or x.get('website'),'phone':x.get('telefono') or x.get('phone'),'email':x.get('email'),'tech_report_keys':list(tr.keys())[:12],'audit_keys':list(au.keys())[:8],'score':x.get('score')})
    print(json.dumps({'id':r.get('id'),'status':r.get('status'),'created_at':r.get('created_at'),'category':r.get('category'),'location':r.get('location'),'count':len(arr),'tech':tech,'audited':audited,'pending_like':pending,'organic':organic,'error':r.get('error')}, ensure_ascii=False))
    for s in samples: print(' SAMPLE', json.dumps(s, ensure_ascii=False))
