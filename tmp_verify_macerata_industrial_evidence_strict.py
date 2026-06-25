import os, json, re
from urllib.parse import urlparse
from supabase import create_client

sb = create_client(
    'https://rtjmnjromqpsfqsgyfvp.supabase.co',
    os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp'
)
rows = sb.table('searches').select('id,status,results,created_at').ilike('category','%celle frigorifere industriali%').ilike('location','%Macerata%').order('created_at', desc=True).limit(1).execute().data or []
refrigeration_terms = ['refriger','frigor','frigo','cold','celle frigorifere','cella frigorifera','impianti frigoriferi','chiller','surgelazione']
scale_terms = ['industriale','industriali','commerciale','commerciali','professionale','professionali','impianti','impianto','celle frigorifere','cella frigorifera','banchi frigo','centrali frigorifere','gruppi frigoriferi','chiller','surgelazione','catena del freddo','gdo','horeca','supermercati','alimentare','agroalimentare']
blocked = ['annunciindustriali','annunci industriali','marketplace','annunci','aste','usato','subito','kijiji','carrello','checkout','spedizione','allforfood','gastrodomus','allfoodproject','forniture alberghiere','attrezzature per ristorazione','ristorazione professionale','elettrodomestici','frigoriferi domestici','frigo casa','domestico','residenziale','civile']
fields = ['azienda','nome','business_name','sito','website','email','telefono','tech_stack','technical_report','descrizione','description','snippet','audit']
for r in rows:
    arr = r.get('results') or []
    if isinstance(arr, str):
        try: arr = json.loads(arr)
        except Exception: arr = []
    print(json.dumps({'job': r['id'], 'status': r['status'], 'count': len(arr), 'created_at': r['created_at'], 'fields_checked': fields}, ensure_ascii=False))
    ok = 0
    for i, x in enumerate(arr if isinstance(arr, list) else [], 1):
        if not isinstance(x, dict):
            continue
        blob = ' '.join(str(x.get(k) or '') for k in fields).lower()
        ref = [t for t in refrigeration_terms if t in blob]
        scale = [t for t in scale_terms if t in blob]
        bad = [t for t in blocked if t in blob]
        verdict = 'OK_INDUSTRIALE' if ref and scale and not bad else 'CONTROLLARE'
        if verdict == 'OK_INDUSTRIALE': ok += 1
        site = x.get('sito') or x.get('website') or ''
        print(json.dumps({
            'n': i,
            'verdict': verdict,
            'name': x.get('azienda') or x.get('nome') or x.get('business_name'),
            'host': urlparse(site).netloc.replace('www.','') if site else '',
            'refrigeration_evidence': ref[:5],
            'industrial_scale_evidence': scale[:5],
            'blocked_evidence': bad[:5],
        }, ensure_ascii=False))
    print(json.dumps({'strict_ok': ok, 'total': len(arr) if isinstance(arr, list) else 0}, ensure_ascii=False))
