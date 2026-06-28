import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET  /api/competitors/alerts — alert competitor non letti
 * POST /api/competitors/alerts — segna come letti (ids[])
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ alerts: [], error: 'Unauthorized' }, { status: 401 })

  const unreadOnly = req.nextUrl.searchParams.get('unread') !== '0'

  let q = supabase
    .from('competitor_alerts')
    .select('*, competitors(name, city)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (unreadOnly) q = q.is('read_at', null)

  const { data, error } = await q

  if (error) {
    if (/does not exist/i.test(error.message)) {
      return NextResponse.json({ alerts: [], tableMissing: true })
    }
    return NextResponse.json({ alerts: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json({ alerts: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : []
  if (!ids.length) return NextResponse.json({ ok: false, error: 'ids obbligatorio' }, { status: 400 })

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('competitor_alerts')
    .update({ read_at: now })
    .eq('user_id', user.id)
    .in('id', ids)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, readAt: now })
}
