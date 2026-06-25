import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET    /api/sequences/runs/[id]            → dettaglio run + lista email schedulate
 * POST   /api/sequences/runs/[id]            → cambia stato (pause|resume|cancel)
 * DELETE /api/sequences/runs/[id]            → elimina run + email future
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID non valido' }, { status: 400 })

  try {
    const { data: run, error } = await supabase
      .from('sequence_runs')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json({ error: 'Tabelle non configurate', tableMissing: true }, { status: 503 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!run) return NextResponse.json({ error: 'Run non trovato' }, { status: 404 })

    const { data: emails } = await supabase
      .from('scheduled_emails')
      .select('id, step_index, subject, body, scheduled_at, status, resend_id, error_message, sent_at')
      .eq('run_id', id)
      .eq('user_id', user.id)
      .order('step_index', { ascending: true })

    return NextResponse.json({ run, emails: emails ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'ID non valido' }, { status: 400 })

  const body = (await req.json().catch(() => null)) as { action?: string } | null
  const action = typeof body?.action === 'string' ? body.action : ''

  if (!['pause', 'resume', 'cancel'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'Azione non valida' }, { status: 400 })
  }

  const newStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled'

  try {
    const { data: run, error: runErr } = await supabase
      .from('sequence_runs')
      .update({
        status: newStatus,
        ...(action === 'cancel' ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (runErr) {
      if (/relation .* does not exist/i.test(runErr.message)) {
        return NextResponse.json({ ok: false, tableMissing: true, error: 'Tabelle non configurate' }, { status: 503 })
      }
      return NextResponse.json({ ok: false, error: runErr.message }, { status: 500 })
    }

    // Se cancel → setta status='cancelled' su tutte le email pending della run
    if (action === 'cancel') {
      await supabase
        .from('scheduled_emails')
        .update({ status: 'cancelled' })
        .eq('run_id', id)
        .eq('user_id', user.id)
        .eq('status', 'pending')
    }

    return NextResponse.json({ ok: true, run })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Errore' }, { status: 500 })
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
    // ON DELETE CASCADE su scheduled_emails: basta cancellare il run
    const { error } = await supabase.from('sequence_runs').delete().eq('id', id).eq('user_id', user.id)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Errore' }, { status: 500 })
  }
}
