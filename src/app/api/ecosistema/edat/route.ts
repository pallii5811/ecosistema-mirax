import { NextResponse } from 'next/server'
import { requireUserSession } from '@/lib/api-auth'

/** GET /api/ecosistema/edat — monitor + alert EDAT per l'utente */
export async function GET() {
  const { supabase, user } = await requireUserSession()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const [monitorsRes, alertsRes, eventsRes] = await Promise.all([
    supabase
      .from('lead_monitors')
      .select('id, search_id, lead_index, created_at, last_checked_at, next_check_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('lead_alerts')
      .select('id, title, message, is_read, created_at, alert_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('mirax_events')
      .select('id, event_type, payload, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return NextResponse.json({
    monitors: monitorsRes.data ?? [],
    alerts: alertsRes.data ?? [],
    events: eventsRes.data ?? [],
  })
}
