from urllib.request import Request, urlopen
from urllib.parse import quote
import re, socket
socket.setdefaulttimeout(8)
queries=['dentisti Milano','agenzie di marketing Torino','ristoranti Bologna','palestre Roma']
urls=lambda q:[
 ('ddg_html', f'https://duckduckgo.com/html/?q={quote(q)}'),
 ('ddg_lite', f'https://lite.duckduckgo.com/lite/?q={quote(q)}'),
 ('mojeek', f'https://www.mojeek.com/search?q={quote(q)}'),
]
for q in queries:
    print('\nQ',q)
    for name,url in urls(q):
        try:
            req=Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'text/html','Accept-Language':'it-IT,it;q=0.9,en;q=0.8'})
            with urlopen(req,timeout=8) as r:
                body=r.read(220000).decode('utf-8','ignore')
                hrefs=re.findall(r'href=["\']([^"\']+)["\']', body, re.I)
                print(name,'status',getattr(r,'status',None),'len',len(body),'hrefs',len(hrefs),'result__a','result__a' in body,'web-result','web-result' in body,'captcha','captcha' in body.lower(),'first',body[:100].replace('\n',' '))
                shown=0
                for h in hrefs:
                    if h.startswith('http') and not any(x in h for x in ['duckduckgo','mojeek','bing','google','youtube','facebook','instagram','linkedin']):
                        print(' ',h[:120]); shown+=1
                        if shown>=5: break
        except Exception as e:
            print(name,'ERR',type(e).__name__,str(e)[:160])
