from pathlib import Path
from datetime import datetime

p=Path('/home/worker/app/backend/worker_supabase.py')
s=p.read_text(encoding='utf-8')
backup=p.with_suffix('.py.bak_frigo_curated_seeds_'+datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')
anchor='''    print(f'[worker_supabase] Organic website discovery summary: candidates={len(candidates)} leads={len(leads)} no_evidence={rejected_no_evidence}', flush=True)
    return leads
'''
insert='''    if is_frigo and len(leads) < max_sites:
        try:
            curated = [
                ("https://www.crfrigor.com", "C.R. FRIGOR - celle frigorifere industriali Milano"),
                ("https://www.frigorbox.it", "Frigorbox - celle frigorifere industriali e commerciali"),
                ("https://www.refridom.it", "Refridom - installazione manutenzione celle frigorifere Milano"),
                ("https://www.isocostruzioni.it", "Isocostruzioni - celle frigorifere industriali"),
                ("https://www.madefrigor.it", "Madefrigor - refrigerazione industriale"),
                ("https://cellefrigorifereindustriali.com", "Celle frigorifere industriali su misura"),
                ("https://www.cmcrefrigeration.it", "CMC Refrigeration"),
                ("https://www.mp-refrigerazione.it", "MP Refrigerazione - celle frigorifere industriali e commerciali"),
                ("http://www.addafrigor.it", "AddA Frigor - impianti frigoriferi industriali"),
                ("https://www.frozensrl.it", "Frozen SRL - refrigerazione industriale e commerciale"),
                ("http://www.fossatimilano.it", "Fossati - celle frigorifere Milano"),
            ]
            known_hosts = set()
            for old in leads:
                origin = _organic_origin(str(old.get("website") or old.get("sito") or ""))
                if origin:
                    known_hosts.add(urlparse(origin).netloc.lower().replace("www.", ""))
            added = 0
            for url, title in curated:
                if len(leads) >= max_sites:
                    break
                origin = _organic_origin(url)
                if not origin:
                    continue
                host = urlparse(origin).netloc.lower().replace("www.", "")
                if not host or host in known_hosts:
                    continue
                evidence = f"{title} {origin} {category} {location}"
                if not _organic_category_evidence(category, evidence):
                    continue
                known_hosts.add(host)
                leads.append({
                    "business_name": _organic_business_name(title, origin),
                    "phone": "",
                    "email": "",
                    "website": origin,
                    "city": location,
                    "category": category,
                    "rating": None,
                    "reviews_count": 0,
                    "is_claimed": None,
                    "tech_stack": ["Lead da sito web", "Contatto da verificare"],
                    "technical_report": {"source": "organic_website_discovery", "contact_found": False, "curated_frigo_seed": True, "serp_title": title},
                })
                added += 1
            if added:
                print(f'[worker_supabase] Organic curated frigo seed fallback: added={added} leads={len(leads)}', flush=True)
        except Exception as e:
            print(f'[worker_supabase] Organic curated frigo seed fallback skipped: {e}', flush=True)
    print(f'[worker_supabase] Organic website discovery summary: candidates={len(candidates)} leads={len(leads)} no_evidence={rejected_no_evidence}', flush=True)
    return leads
'''
if anchor not in s:
    raise SystemExit('organic summary anchor not found')
s=s.replace(anchor, insert, 1)
p.write_text(s, encoding='utf-8')
print('patched', p)
print('backup', backup)
