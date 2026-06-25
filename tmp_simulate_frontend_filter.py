from pathlib import Path
import json, os, re
backend=Path('/home/worker/app/backend')
for line in (backend/'.env').read_text(errors='ignore').splitlines():
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
from supabase import create_client
url=os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb=create_client(url,key)
city='Milano'; cat='celle frigorifere industriali'
rows=sb.table('searches').select('*').eq('status','completed').ilike('location',f'%{city}%').ilike('category',f'%{cat}%').limit(500).execute().data or []
print('ROWS exact ilike', len(rows))
for r in rows:
    arr=r.get('results') or []
    if isinstance(arr,str):
        try: arr=json.loads(arr)
        except: arr=[]
    print('ROW',r.get('id'),r.get('created_at'),r.get('category'),r.get('location'),'count',len(arr))
rows2=sb.table('searches').select('*').eq('status','completed').ilike('location',f'%{city}%').limit(500).execute().data or []
print('ROWS city frigo loose')
for r in rows2:
    c=str(r.get('category') or '').lower()
    if any(x in c for x in ['frigor','refriger','celle']):
        arr=r.get('results') or []
        if isinstance(arr,str):
            try: arr=json.loads(arr)
            except: arr=[]
        org=0
        for x in arr if isinstance(arr,list) else []:
            blob=json.dumps({'tr':x.get('technical_report'),'stack':x.get('tech_stack'),'source':x.get('source')}, ensure_ascii=False).lower()
            if 'organic_website_discovery' in blob or 'lead da sito web' in blob or 'contatto da verificare' in blob: org+=1
        print('ROW2',r.get('id'),r.get('created_at'),r.get('category'),r.get('location'),'count',len(arr),'org',org)
