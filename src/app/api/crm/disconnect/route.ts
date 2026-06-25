import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * POST /api/crm/disconnect
 * Disconnette (soft delete) una integrazione CRM dell'utente.
 * Mantiene lo storico in `crm_sync_log` ma setta is_active = false.
 *
 * Body: { integrationId: string }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { integrationId?: string } | null
  const integrationId = typeof body?.integrationId === 'string' ? body.integrationId : ''

  if (!integrationId) {
    return Response.json({ ok: false, error: 'Missing integrationId' }, { status: 400 })
  }

  // Verifica appartenenza
  const { data: integration, error: iErr } = await supabase
    .from('crm_integrations')
    .select('id')
    .eq('id', integrationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 })

  if (!integration) {
    return Response.json({ ok: false, error: 'Integrazione non trovata' }, { status: 404 })
  }

  const { error: updErr } = await supabase
    .from('crm_integrations')
    .update({ is_active: false })
    .eq('id', integrationId)
    .eq('user_id', user.id)

  if (updErr) return Response.json({ ok: false, error: updErr.message }, { status: 500 })

  return Response.json({ ok: true })
}
