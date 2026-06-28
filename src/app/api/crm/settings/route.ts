import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET  /api/crm/settings — impostazioni auto-sync CRM
 * PATCH /api/crm/settings — aggiorna toggle auto-sync per integrazione
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ integrations: [], error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('crm_integrations')
    .select('id, type, name, auto_sync_hot_leads, auto_create_deals, field_mapping, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (error) {
    if (/does not exist/i.test(error.message)) {
      return NextResponse.json({ integrations: [], tableMissing: true })
    }
    return NextResponse.json({ integrations: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json({ integrations: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body?.id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.auto_sync_hot_leads === 'boolean') patch.auto_sync_hot_leads = body.auto_sync_hot_leads
  if (typeof body.auto_create_deals === 'boolean') patch.auto_create_deals = body.auto_create_deals
  if (body.field_mapping && typeof body.field_mapping === 'object') patch.field_mapping = body.field_mapping

  const { data, error } = await supabase
    .from('crm_integrations')
    .update(patch)
    .eq('id', String(body.id))
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message || 'Non trovato' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, integration: data })
}
