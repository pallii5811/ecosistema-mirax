import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/utils/supabase/server'

/**
 * POST /api/crm/bulk
 * Invia uno o più lead al CRM attivo dell'utente, in batch.
 *
 * Vantaggi rispetto a /api/crm/{hubspot|webhook}:
 *  - Accetta array di lead (fino a 100 per chiamata)
 *  - Per HubSpot usa /crm/v3/objects/contacts/batch/upsert (idProperty=email)
 *    → niente più duplicati per lead con email
 *  - Per lead SENZA email, fallback a POST singolo
 *  - Per webhook, invia un singolo payload con array `leads` (1 chiamata, non N)
 *  - Tracking dettagliato in `crm_sync_log` per ogni lead
 *
 * Body:
 *   { integrationId: string, leads: any[] }
 *
 * Response:
 *   { ok, total, success, failed, results: [{ index, lead_nome, status, error?, hubspot_id? }] }
 */

type LeadIn = Record<string, any>

type ProcessedLead = {
  raw: LeadIn
  nome: string
  sito: string
  email: string
  telefono: string
  citta: string
  categoria: string
  score: number
  opp: string
}

function extract(lead: LeadIn): ProcessedLead {
  const nome = typeof lead?.nome === 'string'
    ? lead.nome
    : typeof lead?.azienda === 'string'
      ? lead.azienda
      : typeof lead?.name === 'string'
        ? lead.name
        : ''
  const sito = typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : ''
  const email = typeof lead?.email === 'string' ? lead.email.trim().toLowerCase() : ''
  const telefono = typeof lead?.telefono === 'string'
    ? lead.telefono
    : typeof lead?.phone === 'string'
      ? lead.phone
      : ''
  const citta = typeof lead?.citta === 'string' ? lead.citta : typeof lead?.city === 'string' ? lead.city : ''
  const categoria = typeof lead?.categoria === 'string'
    ? lead.categoria
    : typeof lead?.category === 'string'
      ? lead.category
      : ''
  const score = Number(lead?.score) || 0

  const opp = [
    !lead?.meta_pixel && !lead?.has_pixel ? 'No Pixel' : '',
    !lead?.google_tag_manager && !lead?.has_gtm ? 'No GTM' : '',
    Array.isArray(lead?.seo_errors) && lead.seo_errors.length > 0 ? 'Errori SEO' : '',
  ]
    .filter(Boolean)
    .join(', ')

  return { raw: lead, nome, sito, email, telefono, citta, categoria, score, opp }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { integrationId?: string; leads?: any[] } | null
  const integrationId = typeof body?.integrationId === 'string' ? body.integrationId : ''
  const leadsRaw = Array.isArray(body?.leads) ? body!.leads : []

  if (!integrationId) return Response.json({ ok: false, error: 'Missing integrationId' }, { status: 400 })
  if (leadsRaw.length === 0) return Response.json({ ok: false, error: 'Lista lead vuota' }, { status: 400 })
  if (leadsRaw.length > 100) {
    return Response.json({ ok: false, error: 'Max 100 lead per chiamata' }, { status: 400 })
  }

  // Recupera integrazione
  const { data: integration, error: iErr } = await supabase
    .from('crm_integrations')
    .select('id, type, config, leads_synced')
    .eq('id', integrationId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 })
  if (!integration) return Response.json({ ok: false, error: 'Integrazione non trovata o disattivata' }, { status: 404 })

  const type = (integration as any).type
  const cfg = (integration as any).config && typeof (integration as any).config === 'object' ? (integration as any).config : {}

  const leads = leadsRaw.map(extract)

  const results: Array<{
    index: number
    lead_nome: string
    status: 'success' | 'error'
    error?: string
    hubspot_id?: string
  }> = []

  const logRows: Array<{
    user_id: string
    integration_id: string
    lead_website: string | null
    lead_nome: string | null
    status: 'success' | 'error'
    error_message: string | null
  }> = []

  let successCount = 0

  // -------- HubSpot path
  if (type === 'hubspot') {
    const access_token = typeof cfg.access_token === 'string' ? cfg.access_token : ''
    if (!access_token) {
      return Response.json({ ok: false, error: 'Missing HubSpot access token' }, { status: 400 })
    }

    // Split: con email → upsert batch, senza email → POST singolo
    const withEmail = leads.map((l, idx) => ({ l, idx })).filter((x) => x.l.email)
    const withoutEmail = leads.map((l, idx) => ({ l, idx })).filter((x) => !x.l.email)

    // 1) batch upsert per i lead con email
    if (withEmail.length > 0) {
      try {
        const upsertBody = {
          inputs: withEmail.map(({ l }) => ({
            idProperty: 'email',
            id: l.email,
            properties: {
              email: l.email,
              company: l.nome || '',
              website: l.sito || '',
              phone: l.telefono || '',
              city: l.citta || '',
              hs_lead_status: 'NEW',
              description: `Lead MiraX — Score: ${l.score} — Opportunità: ${l.opp}`,
            },
          })),
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 25000)
        const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(upsertBody),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout))

        const data = (await res.json().catch(() => null)) as any

        if (res.ok || res.status === 207) {
          const created = Array.isArray(data?.results) ? data.results : []
          // Mappa per email
          const byEmail = new Map<string, any>()
          for (const r of created) {
            const e = (r?.properties?.email || '').toLowerCase()
            if (e) byEmail.set(e, r)
          }

          for (const { l, idx } of withEmail) {
            const r = byEmail.get(l.email)
            results.push({
              index: idx,
              lead_nome: l.nome,
              status: 'success',
              hubspot_id: r?.id || undefined,
            })
            logRows.push({
              user_id: user.id,
              integration_id: integrationId,
              lead_website: l.sito || null,
              lead_nome: l.nome || null,
              status: 'success',
              error_message: null,
            })
            successCount++
          }
        } else {
          const msg = data?.message || `HubSpot batch upsert error (HTTP ${res.status})`
          for (const { l, idx } of withEmail) {
            results.push({ index: idx, lead_nome: l.nome, status: 'error', error: msg })
            logRows.push({
              user_id: user.id,
              integration_id: integrationId,
              lead_website: l.sito || null,
              lead_nome: l.nome || null,
              status: 'error',
              error_message: msg,
            })
          }
        }
      } catch (err: any) {
        const msg = err?.name === 'AbortError' ? 'Timeout HubSpot' : err?.message || 'HubSpot batch fallito'
        for (const { l, idx } of withEmail) {
          results.push({ index: idx, lead_nome: l.nome, status: 'error', error: msg })
          logRows.push({
            user_id: user.id,
            integration_id: integrationId,
            lead_website: l.sito || null,
            lead_nome: l.nome || null,
            status: 'error',
            error_message: msg,
          })
        }
      }
    }

    // 2) POST singolo per lead senza email (HubSpot non supporta upsert senza idProperty)
    for (const { l, idx } of withoutEmail) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              company: l.nome || '',
              website: l.sito || '',
              phone: l.telefono || '',
              city: l.citta || '',
              hs_lead_status: 'NEW',
              description: `Lead MiraX — Score: ${l.score} — Opportunità: ${l.opp}`,
            },
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout))

        const data = (await res.json().catch(() => null)) as any

        if (res.ok) {
          results.push({ index: idx, lead_nome: l.nome, status: 'success', hubspot_id: data?.id })
          logRows.push({
            user_id: user.id,
            integration_id: integrationId,
            lead_website: l.sito || null,
            lead_nome: l.nome || null,
            status: 'success',
            error_message: null,
          })
          successCount++
        } else {
          const msg = data?.message || `HubSpot error (HTTP ${res.status})`
          results.push({ index: idx, lead_nome: l.nome, status: 'error', error: msg })
          logRows.push({
            user_id: user.id,
            integration_id: integrationId,
            lead_website: l.sito || null,
            lead_nome: l.nome || null,
            status: 'error',
            error_message: msg,
          })
        }
      } catch (err: any) {
        const msg = err?.name === 'AbortError' ? 'Timeout HubSpot' : err?.message || 'HubSpot fallito'
        results.push({ index: idx, lead_nome: l.nome, status: 'error', error: msg })
        logRows.push({
          user_id: user.id,
          integration_id: integrationId,
          lead_website: l.sito || null,
          lead_nome: l.nome || null,
          status: 'error',
          error_message: msg,
        })
      }
    }
  }

  // -------- Webhook path: 1 sola POST con array completo
  else if (type === 'webhook') {
    const url = typeof cfg.url === 'string' ? cfg.url : ''
    const secret = typeof cfg.secret === 'string' ? cfg.secret : ''
    const customHeaders = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {}

    if (!url) return Response.json({ ok: false, error: 'Missing webhook url' }, { status: 400 })

    const payload = JSON.stringify({
      event: 'leads.exported',
      version: '1.0',
      timestamp: new Date().toISOString(),
      count: leads.length,
      leads: leads.map((l) => ({
        nome: l.nome,
        sito: l.sito,
        email: l.email,
        telefono: l.telefono,
        citta: l.citta,
        categoria: l.categoria,
        score: l.score,
        opportunita: {
          no_pixel: !l.raw?.meta_pixel && !l.raw?.has_pixel,
          no_gtm: !l.raw?.google_tag_manager && !l.raw?.has_gtm,
          errori_seo: Array.isArray(l.raw?.seo_errors) ? l.raw.seo_errors.length : 0,
        },
      })),
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders as Record<string, string>),
    }
    if (secret) {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
      headers['X-MiraX-Signature'] = `sha256=${signature}`
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 25000)
      const res = await fetch(url, { method: 'POST', headers, body: payload, signal: controller.signal }).finally(() =>
        clearTimeout(timeout)
      )

      const ok = res.ok
      const msg = ok ? null : `HTTP ${res.status}`

      for (let idx = 0; idx < leads.length; idx++) {
        const l = leads[idx]
        results.push({ index: idx, lead_nome: l.nome, status: ok ? 'success' : 'error', error: msg || undefined })
        logRows.push({
          user_id: user.id,
          integration_id: integrationId,
          lead_website: l.sito || null,
          lead_nome: l.nome || null,
          status: ok ? 'success' : 'error',
          error_message: msg,
        })
        if (ok) successCount++
      }
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Timeout webhook' : err?.message || 'Webhook fallito'
      for (let idx = 0; idx < leads.length; idx++) {
        const l = leads[idx]
        results.push({ index: idx, lead_nome: l.nome, status: 'error', error: msg })
        logRows.push({
          user_id: user.id,
          integration_id: integrationId,
          lead_website: l.sito || null,
          lead_nome: l.nome || null,
          status: 'error',
          error_message: msg,
        })
      }
    }
  } else {
    return Response.json({ ok: false, error: `Tipo CRM "${type}" non supportato per bulk` }, { status: 400 })
  }

  // Salva sync log (chunked se >100, ma noi siamo già max 100 → unico insert)
  if (logRows.length > 0) {
    await supabase.from('crm_sync_log').insert(logRows)
  }

  // Aggiorna contatore integrazione
  if (successCount > 0) {
    const currentSynced = typeof (integration as any)?.leads_synced === 'number' ? (integration as any).leads_synced : 0
    await supabase
      .from('crm_integrations')
      .update({ leads_synced: currentSynced + successCount, last_sync_at: new Date().toISOString() })
      .eq('id', integrationId)
      .eq('user_id', user.id)
  }

  return Response.json({
    ok: true,
    total: leads.length,
    success: successCount,
    failed: leads.length - successCount,
    results,
  })
}
