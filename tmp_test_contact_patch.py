import sys, json, asyncio
sys.path.insert(0, '/home/worker/app')
sys.path.insert(0, '/home/worker/app/backend')
import backend.worker_supabase as w

async def main():
    for url in ['https://www.crfrigor.com', 'https://www.frigorbox.it', 'https://www.refridom.it', 'https://www.madefrigor.it']:
        try:
            r = await asyncio.wait_for(w.process_single_url(url), timeout=80)
        except Exception as e:
            print('ERR', url, type(e).__name__, str(e)[:200])
            continue
        print(json.dumps({'url': url, 'name': r.get('nome'), 'phone': r.get('telefono'), 'email': r.get('email'), 'load': r.get('load_speed_seconds'), 'seo_count': len(r.get('seo_errors') or [])}, ensure_ascii=False))

asyncio.run(main())
