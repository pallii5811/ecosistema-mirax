from pathlib import Path
import asyncio, json, os, re, sys

sys.path.insert(0, '/home/worker/app')
sys.path.insert(0, '/home/worker/app/backend')
backend = Path('/home/worker/app/backend')
for line in (backend / '.env').read_text(errors='ignore').splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from supabase import create_client
import backend.worker_supabase as w

url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb = create_client(url, key)

BAD = {'', 'N/D', 'N/A', 'N.D.', 'None', 'none', 'null', '-', '—'}

def has_contact(x):
    phone = str(x.get('telefono') or x.get('phone') or '').strip()
    email = str(x.get('email') or '').strip()
    digits = re.sub(r'\D+', '', phone)
    return (phone not in BAD and len(digits) >= 8) or ('@' in email and email not in BAD)

def is_organic(x):
    blob = json.dumps({'tr': x.get('technical_report'), 'stack': x.get('tech_stack'), 'source': x.get('source')}, ensure_ascii=False).lower()
    return 'organic_website_discovery' in blob or 'lead da sito web' in blob or 'contatto da verificare' in blob

def site_key(x):
    return str(x.get('sito') or x.get('website') or '').lower().replace('https://','').replace('http://','').replace('www.','').rstrip('/')

async def enrich(lead):
    site = str(lead.get('sito') or lead.get('website') or '').strip()
    if not site or site.upper() in BAD:
        return lead
    out = dict(lead)
    try:
        audited = await asyncio.wait_for(w.process_single_url(site), timeout=65)
    except Exception as e:
        tr = dict(out.get('technical_report') or {})
        tr['source'] = tr.get('source') or 'organic_website_discovery'
        tr['organic_audited'] = True
        tr['organic_audit_error'] = str(e)[:200]
        out['technical_report'] = tr
        return out
    if audited.get('telefono'):
        out['telefono'] = audited.get('telefono')
    if audited.get('email'):
        out['email'] = audited.get('email')
    out['meta_pixel'] = bool(audited.get('meta_pixel'))
    out['google_tag_manager'] = bool(audited.get('google_tag_manager'))
    seo = audited.get('seo_errors') if isinstance(audited.get('seo_errors'), list) else []
    out['html_errors'] = len(seo)
    tr = dict(out.get('technical_report') or {})
    tr.update({'source':'organic_website_discovery','organic_audited':True,'contact_found':has_contact(out),'seo_errors':seo,'load_speed_seconds':audited.get('load_speed_seconds'),'has_google_ads':bool(audited.get('has_google_ads'))})
    out['technical_report'] = tr
    if isinstance(audited.get('audit'), dict):
        out['audit'] = audited.get('audit')
    stack = []
    old = out.get('tech_stack')
    if isinstance(old, list):
        stack += [str(v) for v in old if str(v).strip() and 'contatto da verificare' not in str(v).lower()]
    elif old:
        stack.append(str(old))
    if audited.get('tech_stack'):
        stack.append(str(audited.get('tech_stack')))
    if site.lower().startswith('https://') or (isinstance(out.get('audit'), dict) and out['audit'].get('has_ssl')):
        stack.append('SSL')
    stack.append('Meta Pixel' if out.get('meta_pixel') else 'MISSING FB PIXEL')
    stack.append('GTM' if out.get('google_tag_manager') else 'MISSING GTM')
    stack.append('GOOGLE ADS' if tr.get('has_google_ads') else 'MISSING GOOGLE ADS')
    if seo:
        stack.append('ERRORI SEO')
    out['tech_stack'] = list(dict.fromkeys([x for x in stack if str(x).strip()])) or ['Verifica in corso']
    return out

async def main():
    rows = sb.table('searches').select('*').in_('status', ['processing','completed']).order('created_at', desc=True).limit(8).execute().data or []
    for row in rows:
        cat = str(row.get('category') or '')
        loc = str(row.get('location') or '')
        if not (('frigor' in cat.lower() or 'refriger' in cat.lower() or 'celle' in cat.lower()) and 'milan' in loc.lower()):
            continue
        arr = row.get('results') or []
        if isinstance(arr, str):
            try: arr = json.loads(arr)
            except Exception: arr = []
        if not isinstance(arr, list):
            arr = []
        before = len(arr)
        org_before = sum(1 for x in arr if is_organic(x))
        changed = False
        fixed = []
        removed = 0
        for lead in arr:
            if is_organic(lead) and not has_contact(lead):
                enriched = await enrich(lead)
                if has_contact(enriched):
                    fixed.append(enriched)
                    changed = True
                else:
                    removed += 1
                    changed = True
                continue
            fixed.append(lead)
        fixed = w._filter_non_domestic_refrigeration_results(cat, fixed)
        if changed or len(fixed) != before:
            sb.table('searches').update({'results': fixed}).eq('id', row.get('id')).execute()
        print(json.dumps({'id':row.get('id'), 'status':row.get('status'), 'before':before, 'after':len(fixed), 'organic_before':org_before, 'removed_no_contact_organic':removed, 'phones':sum(1 for x in fixed if has_contact({'telefono':x.get('telefono') or x.get('phone')})), 'emails':sum(1 for x in fixed if '@' in str(x.get('email') or ''))}, ensure_ascii=False))

asyncio.run(main())
