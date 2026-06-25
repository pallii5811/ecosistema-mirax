import sys, json, re, asyncio
sys.path.insert(0, '/home/worker/app')
sys.path.insert(0, '/home/worker/app/backend')
import backend.worker_supabase as w

BAD={'','N/D','N/A','N.D.','None','none','null','-','—'}
def has_phone(x):
    phone=str(x.get('telefono') or x.get('phone') or '').strip()
    return phone not in BAD and len(re.sub(r'\D+','',phone))>=8
def has_email(x):
    email=str(x.get('email') or '').strip()
    return '@' in email and email not in BAD

def summarize_lead(x):
    return {
        'name': x.get('business_name') or x.get('azienda') or x.get('nome'),
        'site': x.get('website') or x.get('sito'),
        'phone': x.get('phone') or x.get('telefono'),
        'email': x.get('email'),
        'category': x.get('category') or x.get('categoria'),
        'title': (x.get('technical_report') or {}).get('serp_title') if isinstance(x.get('technical_report'), dict) else None,
    }

cases=[
    ('dentisti', 'Milano'),
    ('agenzie di marketing', 'Torino'),
    ('ristoranti', 'Bologna'),
    ('palestre', 'Roma'),
]
print('ORGANIC_ENABLED', w._organic_enabled())
for category, location in cases:
    print('\n=== CASE', category, location, '===')
    try:
        raw=w._discover_organic_website_leads(category, location)
    except Exception as e:
        print('DISCOVERY_ERROR', type(e).__name__, str(e)[:200])
        continue
    print('RAW_COUNT', len(raw))
    for x in raw[:8]:
        print('RAW', json.dumps(summarize_lead(x), ensure_ascii=False))
    try:
        formatted=w._format_results(raw)
    except Exception as e:
        print('FORMAT_ERROR', type(e).__name__, str(e)[:200])
        formatted=raw
    print('FORMATTED_COUNT', len(formatted), 'phones', sum(1 for x in formatted if has_phone(x)), 'emails', sum(1 for x in formatted if has_email(x)))
    auditable=[]
    for x in formatted[:4]:
        site=str(x.get('sito') or x.get('website') or '').strip()
        if site:
            auditable.append((x,site))
    for x,site in auditable[:2]:
        try:
            audited=asyncio.run(asyncio.wait_for(w.process_single_url(site), timeout=35.0))
            enriched=dict(x)
            if isinstance(audited, dict):
                if audited.get('telefono'): enriched['telefono']=audited.get('telefono')
                if audited.get('email'): enriched['email']=audited.get('email')
            print('AUDIT', json.dumps({'site':site,'name':x.get('azienda') or x.get('business_name'),'phone':enriched.get('telefono') or enriched.get('phone'),'email':enriched.get('email'),'has_phone':has_phone(enriched),'has_email':has_email(enriched)}, ensure_ascii=False))
        except Exception as e:
            print('AUDIT_ERROR', site, type(e).__name__, str(e)[:160])
