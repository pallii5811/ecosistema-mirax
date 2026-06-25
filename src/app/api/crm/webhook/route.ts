import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { lead?: any; integrationId?: string } | null
  const lead = body?.lead
  const integrationId = typeof body?.integrationId === 'string' ? body.integrationId : ''

  if (!integrationId) return Response.json({ error: 'Missing integrationId' }, { status: 400 })

  const { data: integration, error: iErr } = await supabase
    .from('crm_integrations')
    .select('config, leads_synced')
    .eq('id', integrationId)
    .eq('user_id', user.id)
    .eq('type', 'webhook')
    .maybeSingle()

  if (iErr) return Response.json({ error: iErr.message }, { status: 500 })

  if (!integration) {
    return Response.json({ error: 'Integration not found' }, { status: 404 })
  }

  const cfg = (integration as any).config && typeof (integration as any).config === 'object' ? (integration as any).config : {}
  const url = typeof cfg.url === 'string' ? cfg.url : ''
  const secret = typeof cfg.secret === 'string' ? cfg.secret : ''
  const customHeaders = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {}

  if (!url) return Response.json({ error: 'Missing webhook url' }, { status: 400 })

  const nome = typeof lead?.nome === 'string' ? lead.nome : typeof lead?.azienda === 'string' ? lead.azienda : ''
  const sito = typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : ''

  const payload = JSON.stringify({
    event: 'lead.exported',
    timestamp: new Date().toISOString(),
    lead: {
      nome,
      sito,
      email: typeof lead?.email === 'string' ? lead.email : '',
      telefono: typeof lead?.telefono === 'string' ? lead.telefono : typeof lead?.phone === 'string' ? lead.phone : '',
      citta: typeof lead?.citta === 'string' ? lead.citta : typeof lead?.city === 'string' ? lead.city : '',
      categoria: typeof lead?.categoria === 'string' ? lead.categoria : typeof lead?.category === 'string' ? lead.category : '',
      score: Number(lead?.score) || 0,
      opportunita: {
        no_pixel: !lead?.meta_pixel && !lead?.has_pixel,
        no_gtm: !lead?.google_tag_manager && !lead?.has_gtm,
        errori_seo: Array.isArray(lead?.seo_errors) ? lead.seo_errors.length : 0,
      },
    },
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
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
    })

    const status = response.ok ? 'success' : 'error'

    await supabase.from('crm_sync_log').insert({
      user_id: user.id,
      integration_id: integrationId,
      lead_website: sito || null,
      lead_nome: nome || null,
      status,
      error_message: response.ok ? null : `HTTP ${response.status}`,
    })

    if (response.ok) {
      const currentSynced = typeof (integration as any)?.leads_synced === 'number' ? (integration as any).leads_synced : 0
      await supabase
        .from('crm_integrations')
        .update({ leads_synced: currentSynced + 1, last_sync_at: new Date().toISOString() })
        .eq('id', integrationId)
        .eq('user_id', user.id)
    }

    return Response.json({ success: response.ok, status: response.status })
  } catch (err: any) {
    await supabase.from('crm_sync_log').insert({
      user_id: user.id,
      integration_id: integrationId,
      lead_website: sito || null,
      lead_nome: nome || null,
      status: 'error',
      error_message: err?.message || 'Webhook request failed',
    })

    return Response.json({ error: err?.message || 'Webhook request failed' }, { status: 500 })
  }
}
