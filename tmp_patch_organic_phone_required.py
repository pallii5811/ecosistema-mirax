from pathlib import Path
from datetime import datetime

p = Path('/home/worker/app/backend/worker_supabase.py')
s = p.read_text(encoding='utf-8')
backup = p.with_suffix('.py.bak_organic_phone_required_' + datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')

old1 = '''                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    email = str(item.get("email") or "").strip()
                    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
                    return (phone not in bad and len(re.sub(r"\\D+", "", phone)) >= 8) or ("@" in email and email not in bad)
'''
new1 = '''                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
                    return phone not in bad and len(re.sub(r"\\D+", "", phone)) >= 8
'''
if old1 not in s:
    print('publish _has_real_contact marker not found')
else:
    s = s.replace(old1, new1, 1)

old2 = '''    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        email = str(item.get("email") or "").strip()
        digits = re.sub(r"\\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return (phone not in bad and len(digits) >= 8) or ("@" in email and email not in bad)
'''
new2 = '''    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        digits = re.sub(r"\\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return phone not in bad and len(digits) >= 8
'''
if old2 not in s:
    print('filter _has_contact marker not found')
else:
    s = s.replace(old2, new2, 1)

s = s.replace('discarded_no_contact', 'discarded_no_phone')
s = s.replace('removed_organic_no_contact', 'removed_organic_no_phone')
s = s.replace('no_contact_sample', 'no_phone_sample')
s = s.replace('contact=True', 'phone=True')
s = s.replace('contact={bool(enriched.get(\'telefono\') or enriched.get(\'email\'))}', 'phone={bool(enriched.get(\'telefono\'))}')

p.write_text(s, encoding='utf-8')
print('patched=', p)
print('backup=', backup)
