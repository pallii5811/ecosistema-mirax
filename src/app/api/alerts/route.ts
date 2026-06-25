import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { data: alerts, error } = await supabase
      .from('lead_alerts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      // Table might not exist yet — return empty instead of 500
      console.log('[alerts] query error (table may not exist):', error.message)
      return NextResponse.json({ alerts: [] })
    }

    return NextResponse.json({ alerts: alerts || [] })
  } catch (e) {
    return NextResponse.json({ alerts: [] })
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as any
  const alertId = body?.alertId
  if (!alertId) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const { error } = await supabase
    .from('lead_alerts')
    .update({ is_read: true })
    .eq('id', alertId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ success: true })
}
