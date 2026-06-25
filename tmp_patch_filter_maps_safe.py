from pathlib import Path
from datetime import datetime

p = Path('/home/worker/app/backend/worker_supabase.py')
s = p.read_text(encoding='utf-8')
backup = p.with_suffix('.py.bak_filter_maps_safe_' + datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')
start = s.index('def _filter_non_domestic_refrigeration_results(')
end = s.index('\ndef ', start + 10)
new_func = r'''def _filter_non_domestic_refrigeration_results(category: str, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not _is_non_domestic_refrigeration_search(category):
        return results

    domestic_terms = [
        "elettrodomestici", "elettrodomestico", "assistenza elettrodomestici",
        "riparazione elettrodomestici", "riparazioni elettrodomestici",
        "frigoriferi domestici", "frigorifero domestico", "frigo casa", "frigorifero casa",
        "home service", "assistenza autorizzata", "centro assistenza autorizzato",
        "lavatrice", "lavatrici", "lavastoviglie", "asciugatrice", "asciugatrici",
        "forni", "piani cottura", "microonde", "caldaie", "scaldabagni",
        "privati", "appartamenti", "abitazioni", "casa", "domestico", "domestici",
        "civile", "civili", "residenziale", "residenziali", "condizionamento civile",
        "climatizzazione civile", "impianti civili", "utenze domestiche",
    ]

    required_industrial_terms = [
        "refrigerazione industriale", "refrigerazione commerciale",
        "frigorista industriale", "frigoristi industriali",
        "impianti frigoriferi industriali", "impianto frigorifero industriale",
        "impianti frigoriferi", "impianto frigorifero",
        "celle frigorifere", "cella frigorifera", "celle frigo",
        "banchi frigo", "banco frigo", "centrali frigorifere", "centrale frigorifera",
        "gruppi frigoriferi", "gruppo frigorifero", "chiller", "surgelazione",
        "tunnel di surgelazione", "abbattitori", "catena del freddo", "logistica del freddo",
        "cold chain", "gdo", "horeca", "supermercati", "supermercato",
        "alimentare", "agroalimentare", "caseifici", "macelli",
        "industriale", "industriali", "commerciale", "commerciali",
    ]

    def _is_organic(item: Dict[str, Any]) -> bool:
        blob = " ".join([
            str(item.get("source") or ""),
            str(item.get("tech_stack") or ""),
            str(item.get("technical_report") or ""),
        ]).lower()
        return "organic_website_discovery" in blob or "lead da sito web" in blob or "contatto da verificare" in blob

    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        email = str(item.get("email") or "").strip()
        digits = re.sub(r"\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return (phone not in bad and len(digits) >= 8) or ("@" in email and email not in bad)

    filtered: List[Dict[str, Any]] = []
    removed_domestic: List[str] = []
    removed_no_industrial_evidence: List[str] = []
    removed_organic_no_contact: List[str] = []

    for item in results or []:
        evidence_blob = " ".join(
            str(item.get(k) or "")
            for k in [
                "azienda", "nome", "business_name", "sito", "website", "email", "telefono",
                "tech_stack", "technical_report", "descrizione", "description", "snippet",
            ]
        ).lower()
        label = str(item.get("azienda") or item.get("nome") or item.get("business_name") or item.get("sito") or item.get("website") or "").strip()
        has_domestic_signal = any(term in evidence_blob for term in domestic_terms)
        has_required_industrial_signal = any(term in evidence_blob for term in required_industrial_terms)
        is_organic = _is_organic(item)

        if has_domestic_signal:
            removed_domestic.append(label)
            continue

        if is_organic:
            if not _has_contact(item):
                removed_organic_no_contact.append(label)
                continue
            if not has_required_industrial_signal:
                removed_no_industrial_evidence.append(label)
                continue

        filtered.append(item)

    if removed_domestic or removed_no_industrial_evidence or removed_organic_no_contact:
        print(
            f"[worker_supabase] SAFE industrial refrigeration filter: kept={len(filtered)} "
            f"removed_domestic={len(removed_domestic)} removed_organic_no_contact={len(removed_organic_no_contact)} "
            f"removed_organic_no_industrial_evidence={len(removed_no_industrial_evidence)} "
            f"domestic_sample={removed_domestic[:8]} no_contact_sample={removed_organic_no_contact[:8]} "
            f"no_evidence_sample={removed_no_industrial_evidence[:8]}",
            flush=True,
        )
    return filtered
'''
s = s[:start] + new_func + s[end:]
p.write_text(s, encoding='utf-8')
print('patched=', p)
print('backup=', backup)
