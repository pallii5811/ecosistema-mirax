from pathlib import Path
from datetime import datetime

p=Path('/home/worker/app/backend/worker_supabase.py')
s=p.read_text(encoding='utf-8')
backup=p.with_suffix('.py.bak_allow_pre_audit_org_'+datetime.utcnow().strftime('%Y%m%d%H%M%S'))
backup.write_text(s, encoding='utf-8')
old='''        if is_organic:
            if not _has_contact(item):
                removed_organic_no_contact.append(label)
                continue
            if not has_required_industrial_signal:
                removed_no_industrial_evidence.append(label)
                continue
'''
new='''        if is_organic:
            tr = item.get("technical_report") if isinstance(item.get("technical_report"), dict) else {}
            is_audited = bool(tr.get("organic_audited"))
            if is_audited and not _has_contact(item):
                removed_organic_no_contact.append(label)
                continue
            if not has_required_industrial_signal:
                removed_no_industrial_evidence.append(label)
                continue
'''
if old not in s:
    raise SystemExit('anchor not found: organic contact filter block')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('patched',p)
print('backup',backup)
