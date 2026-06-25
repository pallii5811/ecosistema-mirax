from pathlib import Path
s=Path('/home/worker/app/backend/worker_supabase.py').read_text(encoding='utf-8')
for token in ['eq("status", "pending")', "eq('status', 'pending')", 'status=pending', '.order(']:
    print('TOKEN', token, 'count', s.count(token), 'first', s.find(token))
idxs=[s.find('eq("status", "pending")'), s.find("eq('status', 'pending')"), s.find('status=pending')]
for idx in idxs:
    if idx>=0:
        print('---CTX---')
        print(s[max(0,idx-1200):idx+1600])
