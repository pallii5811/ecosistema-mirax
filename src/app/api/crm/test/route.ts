import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * POST /api/crm/test
 * Verifica la validità di una connessione CRM PRIMA di salvarla,
 * o di una connessione già salvata (passando integrationId).
 *
 * Body opzioni:
 *  - { type: 'hubspot', token: '...' } → testa token al volo
 *  - { type: 'webhook', url: '...', secret?: '...' } → ping webhook
 *  - { integrationId: '...' } → testa integrazione salvata
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    | { type?: string; token?: string; url?: string; secret?: string; integrationId?: string }
    | null

  let type = typeof body?.type === 'string' ? body.type : ''
  let token = typeof body?.token === 'string' ? body.token : ''
  let url = typeof body?.url === 'string' ? body.url : ''

  // Se passato integrationId → recupera da DB (P.IVA stesso utente)
  if (body?.integrationId) {
    const { data: integration } = await supabase
      .from('crm_integrations')
      .select('type, config')
      .eq('id', body.integrationId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!integration) {
      return Response.json({ ok: false, error: 'Integrazione non trovata' }, { status: 404 })
    }

    type = (integration as any).type || type
    const cfg = (integration as any).config && typeof (integration as any).config === 'object' ? (integration as any).config : {}
    token = typeof cfg.access_token === 'string' ? cfg.access_token : token
    url = typeof cfg.url === 'string' ? cfg.url : url
  }

  // --- HubSpot: chiama /account-info/v3/details per validare il token
  if (type === 'hubspot') {
    if (!token) return Response.json({ ok: false, error: 'Token mancante' }, { status: 400 })

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch('https://api.hubapi.com/account-info/v3/details', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!res.ok) {
        const err = await res.json().catch(() => null)
        return Response.json(
          {
            ok: false,
            error: err?.message || `HubSpot ha rifiutato il token (HTTP ${res.status})`,
          },
          { status: 200 } // 200 → l'API mostra il risultato test, anche se HubSpot ha detto no
        )
      }

      const account = await res.json().catch(() => null)
      return Response.json({
        ok: true,
        provider: 'hubspot',
        accountId: account?.portalId ?? null,
        timeZone: account?.timeZone ?? null,
        uiDomain: account?.uiDomain ?? null,
      })
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Timeout: HubSpot non risponde' : err?.message || 'Errore di rete'
      return Response.json({ ok: false, error: msg }, { status: 200 })
    }
  }

  // --- Webhook: ping veloce con un evento di test
  if (type === 'webhook') {
    if (!url) return Response.json({ ok: false, error: 'URL mancante' }, { status: 400 })

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return Response.json({ ok: false, error: 'URL non valido' }, { status: 200 })
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return Response.json({ ok: false, error: 'URL deve essere http o https' }, { status: 200 })
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MiraX-Test': 'true' },
        body: JSON.stringify({ event: 'mirax.test', timestamp: new Date().toISOString() }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      return Response.json({
        ok: res.ok,
        provider: 'webhook',
        status: res.status,
        error: res.ok ? null : `Il tuo endpoint ha risposto HTTP ${res.status}`,
      })
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Timeout: il tuo endpoint non risponde' : err?.message || 'Errore di rete'
      return Response.json({ ok: false, error: msg }, { status: 200 })
    }
  }

  return Response.json({ ok: false, error: 'Tipo CRM non supportato' }, { status: 400 })
}
