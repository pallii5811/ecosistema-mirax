import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID non valido' }, { status: 400 })

  try {
    const { data, error } = await supabase
      .from('sequences')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json({ error: 'Tabella sequences non configurata', tableMissing: true }, { status: 503 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Non trovata' }, { status: 404 })
    return NextResponse.json({ sequence: data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'ID non valido' }, { status: 400 })

  try {
    const { error } = await supabase
      .from('sequences')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json({ ok: false, error: 'Tabella sequences non configurata', tableMissing: true }, { status: 503 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Errore' }, { status: 500 })
  }
}
