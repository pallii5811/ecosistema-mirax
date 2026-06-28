import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * PATCH /api/competitors/[id] — aggiorna competitor
 * DELETE /api/competitors/[id] — rimuovi competitor
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'ID non valido' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.website === 'string') patch.website = body.website.trim() || null
  if (typeof body.city === 'string') patch.city = body.city.trim() || null
  if (typeof body.category === 'string') patch.category = body.category.trim() || null
  if (Array.isArray(body.tracked_signals)) {
    patch.tracked_signals = body.tracked_signals.map((s) => String(s)).filter(Boolean)
  }

  const { data, error } = await supabase
    .from('competitors')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message || 'Non trovato' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, competitor: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'ID non valido' }, { status: 400 })
  }

  const { error } = await supabase.from('competitors').delete().eq('id', id).eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
