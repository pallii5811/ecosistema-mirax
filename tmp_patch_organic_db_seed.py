from pathlib import Path
from datetime import datetime

p=Path('/home/worker/app/backend/worker_supabase.py')
s=p.read_text(encoding='utf-8')
backup=p.with_suffix('.py.bak_organic_db_seed_'+datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')

insert_after='''    print(f'[worker_supabase] Organic website discovery summary: candidates={len(candidates)} leads={len(leads)} no_evidence={rejected_no_evidence}', flush=True)
    return leads
'''
replacement='''    if not leads and is_frigo:
        try:
            seeded = []
            seen_seed_hosts = set(seen_hosts)
            seed_rows = supabase.table("searches").select("results, category, location, created_at").eq("status", "completed").ilike("location", f"%{location}%").limit(80).execute().data or []
            for row in seed_rows:
                row_cat = str(row.get("category") or "").lower()
                if not any(x in row_cat for x in ["frigo", "frigor", "refriger", "celle frigor"]):
                    continue
                arr = row.get("results") or []
                if isinstance(arr, str):
                    try:
                        arr = json.loads(arr)
                    except Exception:
                        arr = []
                if not isinstance(arr, list):
                    continue
                for old in arr:
                    site = str(old.get("sito") or old.get("website") or "").strip()
                    origin = _organic_origin(site)
                    if not origin:
                        continue
                    host = urlparse(origin).netloc.lower().replace("www.", "")
                    if not host or host in seen_seed_hosts:
                        continue
                    evidence = " ".join(str(old.get(k) or "") for k in ["azienda", "business_name", "nome", "categoria", "category", "sito", "website", "technical_report", "tech_stack"])
                    if not _organic_category_evidence(category, evidence):
                        continue
                    seen_seed_hosts.add(host)
                    seeded.append({
                        "business_name": str(old.get("azienda") or old.get("business_name") or old.get("nome") or _organic_business_name("", origin)),
                        "phone": str(old.get("telefono") or old.get("phone") or ""),
                        "email": str(old.get("email") or ""),
                        "website": origin,
                        "city": location,
                        "category": category,
                        "rating": old.get("rating"),
                        "reviews_count": old.get("reviews_count") or old.get("recensioni") or 0,
                        "is_claimed": old.get("is_claimed"),
                        "tech_stack": old.get("tech_stack") if isinstance(old.get("tech_stack"), list) else ["Lead da sito web", "Contatto da verificare"],
                        "technical_report": old.get("technical_report") if isinstance(old.get("technical_report"), dict) else {"source": "organic_website_discovery", "seeded_from_db": True},
                    })
                    if len(seeded) >= max_sites:
                        break
                if len(seeded) >= max_sites:
                    break
            if seeded:
                leads = seeded
                print(f'[worker_supabase] Organic DB seed fallback: leads={len(leads)}', flush=True)
        except Exception as e:
            print(f'[worker_supabase] Organic DB seed fallback skipped: {e}', flush=True)
    print(f'[worker_supabase] Organic website discovery summary: candidates={len(candidates)} leads={len(leads)} no_evidence={rejected_no_evidence}', flush=True)
    return leads
'''
if insert_after not in s:
    raise SystemExit('anchor not found for organic summary return')
s=s.replace(insert_after,replacement,1)
p.write_text(s,encoding='utf-8')
print('patched',p)
print('backup',backup)
