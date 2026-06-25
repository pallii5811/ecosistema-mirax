import os, subprocess
from pathlib import Path
backend=Path('/home/worker/app/backend')
print('=== ORGANIC ENV ===')
try:
    lines=(backend/'.env').read_text(errors='ignore').splitlines()
except Exception as e:
    lines=[]; print('env read error', e)
for line in lines:
    if any(k in line for k in ['ORGANIC','BRAVE','BING','GOOGLE','SERP','DISCOVERY']):
        if '=' in line:
            k,v=line.split('=',1)
            if any(secret in k.upper() for secret in ['KEY','TOKEN','SECRET']): v='***'
            print(k+'='+v)
        else:
            print(line)
print('=== RECENT ORGANIC LOGS ===')
cmd=['journalctl','-u','mirax-worker@1.service','-u','mirax-worker@2.service','-u','mirax-worker@3.service','-u','mirax-worker@4.service','-u','mirax-worker@5.service','-u','mirax-worker@6.service','-u','mirax-worker@7.service','-u','mirax-worker@8.service','-u','mirax-worker@9.service','-u','mirax-worker@10.service','-u','mirax-worker@11.service','-u','mirax-worker@12.service','--since','6 hours ago','--no-pager']
try:
    out=subprocess.check_output(cmd, text=True, errors='replace')
except Exception as e:
    print('journalctl error', e)
    out=''
keys=['c1c04ffb','Organic','organic','Progressive','Preserved existing','SAFE industrial','discarded','no_contact','no_phone','Job ', 'completato']
for line in out.splitlines():
    if any(k in line for k in keys):
        print(line[-1800:])
