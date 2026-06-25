from pathlib import Path
from datetime import datetime

p = Path('/home/worker/app/backend/worker_supabase.py')
s = p.read_text(encoding='utf-8')
backup = p.with_suffix('.py.bak_allow_audited_email_org_' + datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')

s = s.replace('''                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
                    return phone not in bad and len(re.sub(r"\\D+", "", phone)) >= 8
''', '''                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    email = str(item.get("email") or "").strip()
                    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
                    return (phone not in bad and len(re.sub(r"\\D+", "", phone)) >= 8) or ("@" in email and email not in bad)
''')

s = s.replace('''    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        digits = re.sub(r"\\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return phone not in bad and len(digits) >= 8
''', '''    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        email = str(item.get("email") or "").strip()
        digits = re.sub(r"\\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return (phone not in bad and len(digits) >= 8) or ("@" in email and email not in bad)
''')

s = s.replace('removed_organic_no_phone', 'removed_organic_no_contact')
s = s.replace('discarded_no_phone', 'discarded_no_contact')
s = s.replace('no_phone_sample', 'no_contact_sample')
s = s.replace('phone=True', 'contact=True')
s = s.replace('discarded no-contact', 'discarded no-contact')
s = s.replace('removed_organic_no_contact={len(removed_organic_no_contact)}', 'removed_organic_no_contact={len(removed_organic_no_contact)}')

p.write_text(s, encoding='utf-8')
print('patched=', p)
print('backup=', backup)
