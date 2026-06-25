from pathlib import Path
s = Path('/home/worker/app/backend/worker_supabase.py').read_text(encoding='utf-8')
for token in ['def _publish_progressive_organic', 'def _has_real_contact', 'def _has_contact(item: Dict[str, Any])', 'discarded_no_phone', 'discarded_no_contact']:
    print('TOKEN', token, 'count=', s.count(token), 'idx=', s.find(token))
    i = s.find(token)
    if i >= 0:
        print(s[max(0, i-500):i+1400])
        print('---')
