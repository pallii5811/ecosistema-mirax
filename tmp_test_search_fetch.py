from urllib.request import Request, urlopen
from urllib.parse import quote
import socket, sys
socket.setdefaulttimeout(6)
q='celle frigorifere industriali Milano'
urls=[
 ('bing', f'https://www.bing.com/search?q={quote(q)}&setlang=it-IT&cc=IT&count=10'),
 ('brave', f'https://search.brave.com/search?q={quote(q)}&source=web'),
 ('google', f'https://www.google.com/search?q={quote(q)}&hl=it&gl=it&num=10'),
 ('ddg', f'https://duckduckgo.com/html/?q={quote(q)}'),
]
for name,url in urls:
    try:
        req=Request(url,headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'text/html,application/xhtml+xml','Accept-Language':'it-IT,it;q=0.9,en;q=0.8'})
        with urlopen(req, timeout=6) as r:
            body=r.read(180000).decode('utf-8','ignore')
            low=body.lower()
            print(name,'OK','status',getattr(r,'status',None),'ct',r.headers.get('content-type'),'len',len(body),'hrefs',low.count('href='),'captcha','captcha' in low,'blocked','unusual traffic' in low or 'verify' in low,'b_algo','b_algo' in body,'result__a','result__a' in body, flush=True)
            print(body[:160].replace('\n',' ')[:160], flush=True)
    except Exception as e:
        print(name,'ERR',type(e).__name__,str(e)[:180], flush=True)
