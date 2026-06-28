import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { dispatchLeadsToIntegration, loadCrmIntegration } from '@/lib/nous/dispatcher'
import { normalizeLeads } from '@/lib/nous/normalizer'
import { NOUS_EVENTS } from '@/lib/nous/events'

/**
 * POST /api/crm/bulk — invia fino a 100 lead via adapter NOUS (HubSpot / webhook / Salesforce).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { integrationId?: string; leads?: unknown[] } | null
  const integrationId = typeof body?.integrationId === 'string' ? body.integrationId : ''
  const leadsRaw = Array.isArray(body?.leads) ? body.leads : []

  if (!integrationId) return Response.json({ ok: false, error: 'Missing integrationId' }, { status: 400 })
  if (leadsRaw.length === 0) return Response.json({ ok: false, error: 'Lista lead vuota' }, { status: 400 })
  if (leadsRaw.length > 100) {
    return Response.json({ ok: false, error: 'Max 100 lead per chiamata' }, { status: 400 })
  }

  const integration = await loadCrmIntegration(supabase, user.id, integrationId, undefined, {
    requireActive: true,
  })
  if (!integration) {
    return Response.json({ ok: false, error: 'Integrazione non trovata o disattivata' }, { status: 404 })
  }

  const leads = normalizeLeads(leadsRaw)
  const result = await dispatchLeadsToIntegration(supabase, {
    userId: user.id,
    integration,
    event: leads.length === 1 ? NOUS_EVENTS.LEAD_EXPORTED : NOUS_EVENTS.LEADS_EXPORTED,
    leads,
  })

  return Response.json({
    ok: result.success > 0,
    total: result.total,
    success: result.success,
    failed: result.failed,
    results: result.results.map((r) => ({
      index: r.index,
      lead_nome: r.lead_nome,
      status: r.status,
      error: r.error,
      hubspot_id: integration.type === 'hubspot' ? r.external_id : undefined,
      salesforce_id: integration.type === 'salesforce' ? r.external_id : undefined,
    })),
  })
}
