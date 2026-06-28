import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { dispatchLeadsToIntegration, loadCrmIntegration } from '@/lib/nous/dispatcher'
import { normalizeLead } from '@/lib/nous/normalizer'
import { NOUS_EVENTS } from '@/lib/nous/events'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { lead?: Record<string, unknown>; integrationId?: string } | null
  const integrationId = typeof body?.integrationId === 'string' ? body.integrationId : ''
  if (!integrationId) return Response.json({ error: 'Missing integrationId' }, { status: 400 })

  const integration = await loadCrmIntegration(supabase, user.id, integrationId, 'salesforce')
  if (!integration) return Response.json({ error: 'Integration not found' }, { status: 404 })

  const lead = normalizeLead(body?.lead)
  const result = await dispatchLeadsToIntegration(supabase, {
    userId: user.id,
    integration,
    event: NOUS_EVENTS.LEAD_EXPORTED,
    leads: [lead],
  })

  const first = result.results[0]
  if (!first || first.status === 'error') {
    return Response.json({ error: first?.error || 'Salesforce export failed' }, { status: 400 })
  }

  return Response.json({ success: true, salesforce_id: first.external_id ?? null })
}
