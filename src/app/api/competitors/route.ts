import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const DEFAULT_TRACKED = ['hiring', 'tender_won']

/**
 * GET  /api/competitors — lista competitor tracciati
 * POST /api/competitors — aggiungi competitor
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ competitors: [], error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) {
    if (/does not exist/i.test(error.message)) {
      return NextResponse.json({ competitors: [], tableMissing: true })
    }
    return NextResponse.json({ competitors: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json({ competitors: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, error: 'Body non valido' }, { status: 400 })

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ ok: false, error: 'Nome obbligatorio' }, { status: 400 })

  const tracked = Array.isArray(body.tracked_signals)
    ? body.tracked_signals.map((s) => String(s)).filter(Boolean)
    : DEFAULT_TRACKED

  const row = {
    user_id: user.id,
    name,
    website: String(body.website || '').trim() || null,
    city: String(body.city || '').trim() || null,
    category: String(body.category || '').trim() || null,
    tracked_signals: tracked.length ? tracked : DEFAULT_TRACKED,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase.from('competitors').insert(row).select('*').single()

  if (error) {
    if (/does not exist/i.test(error.message)) {
      return NextResponse.json({ ok: false, tableMissing: true, error: error.message }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, competitor: data })
}
