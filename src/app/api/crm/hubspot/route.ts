import { NextRequest } from 'next/server'
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
    .eq('type', 'hubspot')
    .maybeSingle()

  if (iErr) return Response.json({ error: iErr.message }, { status: 500 })

  if (!integration) {
    return Response.json({ error: 'Integration not found' }, { status: 404 })
  }

  const cfg = (integration as any).config && typeof (integration as any).config === 'object' ? (integration as any).config : {}
  const access_token = typeof cfg.access_token === 'string' ? cfg.access_token : ''

  if (!access_token) {
    return Response.json({ error: 'Missing HubSpot access token' }, { status: 400 })
  }

  const nome = typeof lead?.nome === 'string' ? lead.nome : typeof lead?.azienda === 'string' ? lead.azienda : ''
  const sito = typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : ''
  const telefono = typeof lead?.telefono === 'string' ? lead.telefono : typeof lead?.phone === 'string' ? lead.phone : ''
  const email = typeof lead?.email === 'string' ? lead.email : ''
  const citta = typeof lead?.citta === 'string' ? lead.citta : typeof lead?.city === 'string' ? lead.city : ''

  const score = Number(lead?.score) || 0

  const opp = [
    !lead?.meta_pixel && !lead?.has_pixel ? 'No Pixel' : '',
    !lead?.google_tag_manager && !lead?.has_gtm ? 'No GTM' : '',
    Array.isArray(lead?.seo_errors) && lead.seo_errors.length > 0 ? 'Errori SEO' : '',
  ]
    .filter(Boolean)
    .join(', ')

  try {
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          company: nome || '',
          website: sito || '',
          phone: telefono || '',
          email: email || '',
          city: citta || '',
          hs_lead_status: 'NEW',
          description: `Lead MiraX — Score: ${score} — Opportunità: ${opp}`,
        },
      }),
    })

    const result = (await response.json().catch(() => null)) as any

    if (!response.ok) {
      await supabase.from('crm_sync_log').insert({
        user_id: user.id,
        integration_id: integrationId,
        lead_website: sito || null,
        lead_nome: nome || null,
        status: 'error',
        error_message: result?.message || 'HubSpot API error',
      })

      return Response.json({ error: result?.message || 'HubSpot API error' }, { status: 400 })
    }

    const currentSynced = typeof (integration as any)?.leads_synced === 'number' ? (integration as any).leads_synced : 0

    await Promise.all([
      supabase.from('crm_sync_log').insert({
        user_id: user.id,
        integration_id: integrationId,
        lead_website: sito || null,
        lead_nome: nome || null,
        status: 'success',
      }),
      supabase
        .from('crm_integrations')
        .update({ leads_synced: currentSynced + 1, last_sync_at: new Date().toISOString() })
        .eq('id', integrationId)
        .eq('user_id', user.id),
    ])

    return Response.json({ success: true, hubspot_id: result?.id ?? null })
  } catch (err: any) {
    await supabase.from('crm_sync_log').insert({
      user_id: user.id,
      integration_id: integrationId,
      lead_website: sito || null,
      lead_nome: nome || null,
      status: 'error',
      error_message: err?.message || 'HubSpot request failed',
    })

    return Response.json({ error: err?.message || 'HubSpot request failed' }, { status: 500 })
  }
}
