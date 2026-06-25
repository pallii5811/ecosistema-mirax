from pathlib import Path
s=Path('/home/worker/app/backend/worker_supabase.py').read_text(encoding='utf-8')
for token in ['Organic website discovery final merge', 'organic_formatted', 'Progressive organic discovery candidates', '_publish_progressive_organic']:
    i=s.find(token)
    print('\n=== TOKEN', token, 'IDX', i, '===')
    if i >= 0:
        print(s[max(0, i-3500):i+3500])
