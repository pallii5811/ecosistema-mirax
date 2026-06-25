from pathlib import Path
from datetime import datetime

p=Path('/home/worker/app/backend/worker_supabase.py')
s=p.read_text(encoding='utf-8')
backup=p.with_suffix('.py.bak_organic_quality_gate_'+datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')

s=s.replace("""            'mapcarta.', 'tuttocitta.', 'aziende.it', 'informazione-aziende.it', 'reteimprese.it', 'microsoft.com', 'msn.com',
""","""            'mapcarta.', 'tuttocitta.', 'aziende.it', 'informazione-aziende.it', 'reteimprese.it', 'microsoft.com', 'msn.com',
            'annunciindustriali.it', 'subito.it', 'kijiji.', 'marketplace.', 'facebook.', 'pinterest.',
""",1)

s=s.replace("""        if any(bad in e for bad in ["example.com", "sentry", "wixpress", ".png", ".jpg", ".svg"]):
""","""        if any(bad in e for bad in ["example.com", "company.com", "yourdomain", "yoursite", "tuodominio", "tuosito", "ninjamailtrap", "mailtrap", "sentry", "wixpress", ".png", ".jpg", ".svg"]):
""",1)

s=s.replace("""    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        email = str(item.get("email") or "").strip()
        digits = re.sub(r"\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return (phone not in bad and len(digits) >= 8) or ("@" in email and email not in bad)
""","""    def _is_real_email(email: str) -> bool:
        email = str(email or "").strip().lower()
        bad = {"", "n/d", "n/a", "n.d.", "none", "null", "-", "—"}
        fake = ["example.com", "company.com", "yourdomain", "yoursite", "tuodominio", "tuosito", "ninjamailtrap", "mailtrap", "sentry", "wixpress"]
        return "@" in email and email not in bad and not any(x in email for x in fake)

    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        email = str(item.get("email") or "").strip()
        digits = re.sub(r"\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return (phone not in bad and len(digits) >= 8) or _is_real_email(email)

    def _has_specific_refrigeration_signal(text: str) -> bool:
        t = str(text or "").lower()
        specific = [
            "refrigerazione", "frigorif", "frigorist", "celle frigor", "cella frigor", "celle frigo",
            "impianti frigor", "impianto frigor", "banchi frigo", "banco frigo", "centrali frigor",
            "gruppi frigor", "chiller", "surgelazione", "catena del freddo", "logistica del freddo", "cold chain",
            "abbattitori", "magazzini frigor", "magazzino frigor",
        ]
        generic_bad = ["annunci", "marketplace", "aste", "usato", "subito", "directory", "portale"]
        return any(x in t for x in specific) and not any(x in t for x in generic_bad)
""",1)

s=s.replace("""            if not has_required_industrial_signal:
                removed_no_industrial_evidence.append(label)
                continue
""","""            if not _has_specific_refrigeration_signal(evidence_blob):
                removed_no_industrial_evidence.append(label)
                continue
""",1)

s=s.replace("""                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    email = str(item.get("email") or "").strip()
                    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null"}
                    return (phone not in bad and len(re.sub(r"\D+", "", phone)) >= 8) or ("@" in email and email not in bad)
""","""                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    email = str(item.get("email") or "").strip().lower()
                    bad = {"", "n/d", "n/a", "n.d.", "none", "null", "-", "—"}
                    fake = ["example.com", "company.com", "yourdomain", "yoursite", "tuodominio", "tuosito", "ninjamailtrap", "mailtrap", "sentry", "wixpress"]
                    real_email = "@" in email and email not in bad and not any(x in email for x in fake)
                    return (phone not in bad and len(re.sub(r"\D+", "", phone)) >= 8) or real_email
""",1)

p.write_text(s, encoding='utf-8')
print('patched', p)
print('backup', backup)
