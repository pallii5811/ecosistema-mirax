from pathlib import Path
from datetime import datetime

p = Path('/home/worker/app/backend/worker_supabase.py')
s = p.read_text(encoding='utf-8')
backup = p.with_suffix('.py.bak_publish_only_audited_organic_' + datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')

start = s.index('            def _publish_progressive_organic():')
end = s.index("\n            try:\n                __import__('threading').Thread(target=_publish_progressive_organic", start)
new_func = r'''            def _publish_progressive_organic():
                def _site_key(item):
                    return str(item.get("sito") or item.get("website") or "").lower().strip().replace("https://", "").replace("http://", "").replace("www.", "").rstrip("/")

                def _merge_replace(current, enriched):
                    key = _site_key(enriched)
                    out = []
                    replaced = False
                    for row in current or []:
                        if key and _site_key(row) == key:
                            out.append(enriched)
                            replaced = True
                        else:
                            out.append(row)
                    if not replaced:
                        out.append(enriched)
                    return out

                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    email = str(item.get("email") or "").strip()
                    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null"}
                    return (phone not in bad and len(re.sub(r"\D+", "", phone)) >= 8) or ("@" in email and email not in bad)

                def _enrich_organic_lead(lead):
                    site = str(lead.get("sito") or lead.get("website") or "").strip()
                    if not site:
                        return lead
                    enriched = dict(lead)
                    try:
                        audited = asyncio.run(asyncio.wait_for(process_single_url(site), timeout=55.0))
                    except Exception as e:
                        tr = dict(enriched.get("technical_report") or {})
                        tr["source"] = tr.get("source") or "organic_website_discovery"
                        tr["organic_audited"] = True
                        tr["organic_audit_error"] = str(e)[:200]
                        enriched["technical_report"] = tr
                        return enriched

                    if isinstance(audited, dict):
                        if audited.get("telefono"):
                            enriched["telefono"] = audited.get("telefono")
                        if audited.get("email"):
                            enriched["email"] = audited.get("email")
                        if audited.get("nome") and not str(enriched.get("azienda") or "").strip():
                            enriched["azienda"] = audited.get("nome")
                        enriched["meta_pixel"] = bool(audited.get("meta_pixel"))
                        enriched["google_tag_manager"] = bool(audited.get("google_tag_manager"))
                        seo_errors = audited.get("seo_errors") if isinstance(audited.get("seo_errors"), list) else []
                        enriched["html_errors"] = len(seo_errors)

                        tr = dict(enriched.get("technical_report") or {})
                        tr["source"] = "organic_website_discovery"
                        tr["organic_audited"] = True
                        tr["contact_found"] = _has_real_contact(enriched)
                        tr["seo_errors"] = seo_errors
                        tr["load_speed_seconds"] = audited.get("load_speed_seconds")
                        tr["has_google_ads"] = bool(audited.get("has_google_ads"))
                        enriched["technical_report"] = tr

                        audit = audited.get("audit") if isinstance(audited.get("audit"), dict) else {}
                        enriched["audit"] = audit

                        stack = []
                        old_stack = enriched.get("tech_stack")
                        if isinstance(old_stack, list):
                            stack.extend([str(x) for x in old_stack if str(x).strip() and str(x).lower() not in {"contatto da verificare"}])
                        elif old_stack:
                            stack.append(str(old_stack))
                        ts = str(audited.get("tech_stack") or "").strip()
                        if ts:
                            stack.append(ts.upper() if ts.lower() in {"wordpress", "wix", "shopify"} else ts)
                        if audit.get("has_ssl") or str(site).lower().startswith("https://"):
                            stack.append("SSL")
                        stack.append("Meta Pixel" if enriched.get("meta_pixel") else "MISSING FB PIXEL")
                        stack.append("GTM" if enriched.get("google_tag_manager") else "MISSING GTM")
                        stack.append("GOOGLE ADS" if tr.get("has_google_ads") else "MISSING GOOGLE ADS")
                        if seo_errors:
                            stack.append("ERRORI SEO")
                        try:
                            if audited.get("load_speed_seconds") is not None and float(audited.get("load_speed_seconds")) > 4.0:
                                stack.append("SITO LENTO")
                        except Exception:
                            pass
                        enriched["tech_stack"] = list(dict.fromkeys([x for x in stack if str(x).strip()])) or ["Verifica in corso"]
                    return enriched

                try:
                    organic_raw = _discover_organic_website_leads(category=category, location=location)
                    organic_formatted = _format_results(organic_raw)
                    if not organic_formatted:
                        print("[worker_supabase] Progressive organic discovery: +0 lead", flush=True)
                        return
                    print(f"[worker_supabase] Progressive organic discovery candidates: {len(organic_formatted)}; auditing before publish", flush=True)
                    max_audit = _organic_env_int("ORGANIC_AUDIT_MAX_SITES", len(organic_formatted), 0, 24)
                    published = 0
                    discarded_no_contact = 0
                    for lead in organic_formatted[:max_audit]:
                        enriched = _enrich_organic_lead(lead)
                        if not _has_real_contact(enriched):
                            discarded_no_contact += 1
                            print(f"[worker_supabase] Progressive organic audit discarded no-contact: {enriched.get('azienda') or enriched.get('sito')}", flush=True)
                            continue
                        with _rt_lock:
                            updated = _merge_replace(list(_rt_results), enriched)
                            updated = _filter_non_domestic_refrigeration_results(category, updated)
                            _rt_results.clear()
                            _rt_results.extend(updated)
                            snapshot = list(_rt_results)
                        supabase.table("searches").update({"results": snapshot}).eq("id", job_id).execute()
                        published += 1
                        print(f"[worker_supabase] Progressive organic audit published: {enriched.get('azienda') or enriched.get('sito')} contact=True total={len(snapshot)}", flush=True)
                    print(f"[worker_supabase] Progressive organic audit summary: candidates={len(organic_formatted)} published={published} discarded_no_contact={discarded_no_contact}", flush=True)
                except Exception as e:
                    print(f"[worker_supabase] Progressive organic discovery skipped: {e}", flush=True)
'''
s = s[:start] + new_func + s[end:]

old_final = '''                if organic_formatted:
                    formatted = _merge_formatted_results(formatted, organic_formatted)
                    with _rt_lock:
                        formatted = _merge_formatted_results(_rt_results, formatted)
                    print(f"[worker_supabase] Organic website discovery: +{len(organic_formatted)} lead")'''
new_final = '''                if organic_formatted:
                    with _rt_lock:
                        formatted = _merge_formatted_results(_rt_results, formatted)
                    print(f"[worker_supabase] Organic website discovery final merge uses audited progressive leads only; raw_candidates={len(organic_formatted)}")'''
if old_final in s:
    s = s.replace(old_final, new_final, 1)
else:
    print('final organic marker not found; no final placeholder patch applied')

p.write_text(s, encoding='utf-8')
print('patched=', p)
print('backup=', backup)
