/**
 * GET /api/universe/alerts
 * Fase 9 — alert grafo (lead_alerts.alert_type = universe_graph).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const unreadOnly = req.nextUrl.searchParams.get('unread') !== '0'
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 20))

  let query = supabase
    .from('lead_alerts')
    .select('*')
    .eq('user_id', user.id)
    .eq('alert_type', 'universe_graph')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) query = query.eq('is_read', false)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: true, alerts: [] })
  }

  return NextResponse.json({ ok: true, alerts: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const alertId = typeof body?.alert_id === 'string' ? body.alert_id : ''
  if (!alertId) return NextResponse.json({ error: 'alert_id richiesto' }, { status: 400 })

  const { error } = await supabase
    .from('lead_alerts')
    .update({ is_read: true })
    .eq('id', alertId)
    .eq('user_id', user.id)
    .eq('alert_type', 'universe_graph')

  if (error) {
    console.error('[universe/alerts] update error', error)
    return NextResponse.json({ error: 'Errore aggiornamento alert' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
