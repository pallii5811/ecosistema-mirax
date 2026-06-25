import os, json, re
from urllib.parse import urlparse
from supabase import create_client

sb = create_client(
    'https://rtjmnjromqpsfqsgyfvp.supabase.co',
    os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY') or 'sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp'
)
rows = sb.table('searches').select('id,status,category,location,results,created_at').ilike('category','%celle frigorifere industriali%').ilike('location','%Macerata%').order('created_at', desc=True).limit(1).execute().data or []
terms_strong = [
    'refrigerazione industriale','refrigerazione commerciale','impianti frigoriferi','impianto frigorifero',
    'celle frigorifere','cella frigorifera','celle frigo','frigorista','frigoristi','frigoriferi industriali',
    'centrali frigorifere','gruppi frigoriferi','chiller','surgelazione','catena del freddo','magazzini frigoriferi',
]
terms_root = ['refriger','frigor','frigo','cold']
blocked = ['annunciindustriali','annunci industriali','marketplace','annunci','aste','usato','subito','kijiji','carrello','checkout','spedizione','allforfood','gastrodomus','allfoodproject','forniture alberghiere','attrezzature per ristorazione','ristorazione professionale']
for r in rows:
    arr = r.get('results') or []
    if isinstance(arr, str):
        try: arr = json.loads(arr)
        except Exception: arr = []
    if not isinstance(arr, list): arr = []
    print(json.dumps({'job': r['id'], 'status': r['status'], 'count': len(arr), 'created_at': r['created_at']}, ensure_ascii=False))
    for i, x in enumerate(arr, 1):
        if not isinstance(x, dict):
            continue
        fields = []
        for k in ['azienda','nome','business_name','categoria','category','descrizione','description','sito','website','indirizzo','address','tech_stack','technical_report','audit']:
            fields.append(str(x.get(k) or ''))
        blob = ' '.join(fields).lower()
        strong = [t for t in terms_strong if t in blob]
        root = [t for t in terms_root if t in blob]
        bad = [t for t in blocked if t in blob]
        digits = re.sub(r'\D+','', str(x.get('telefono') or x.get('phone') or ''))
        site = x.get('sito') or x.get('website') or ''
        host = urlparse(site).netloc.replace('www.','') if site else ''
        verdict = 'OK_FORTE' if strong and not bad else ('OK_ROOT' if root and not bad else ('BLOCCARE' if bad else 'BORDERLINE'))
        print(json.dumps({
            'n': i,
            'verdict': verdict,
            'name': x.get('azienda') or x.get('nome') or x.get('business_name'),
            'host': host,
            'phone_ok': len(digits) >= 8,
            'email': x.get('email') or '',
            'strong_terms': strong[:4],
            'root_terms': root[:4],
            'blocked_terms': bad[:4],
        }, ensure_ascii=False))
