import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getSequenceByKey } from '@/lib/outbound/sequences'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/outbound/queue/[id]/approve — HITL: approva e schedula (no invio immediato)
 * Body: { selectedVariant?, senderEmail, senderName? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const senderEmail = String(body.senderEmail || '').trim()
  const senderName = String(body.senderName || '').trim() || null
  const selectedVariant = String(body.selectedVariant || 'A').toUpperCase()

  if (!EMAIL_RE.test(senderEmail)) {
    return NextResponse.json({ ok: false, error: 'Email mittente obbligatoria' }, { status: 400 })
  }

  const { data: item, error: fetchErr } = await supabase
    .from('outbound_queue')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (fetchErr || !item) {
    return NextResponse.json({ ok: false, error: 'Elemento coda non trovato' }, { status: 404 })
  }

  if (item.status !== 'pending_approval') {
    return NextResponse.json({ ok: false, error: `Stato non approvabile: ${item.status}` }, { status: 409 })
  }

  const variants = Array.isArray(item.variants) ? item.variants : []
  const picked =
    variants.find((v: { label?: string }) => String(v?.label).toUpperCase() === selectedVariant) ||
    variants[0]
  const subject = String(picked?.subject || item.subject)
  const emailBody = String(picked?.body || item.body)
  const recipientEmail = String(item.lead_email || '').trim()

  if (!EMAIL_RE.test(recipientEmail)) {
    return NextResponse.json({ ok: false, error: 'Email destinatario mancante o non valida' }, { status: 400 })
  }

  const seq = getSequenceByKey(String(item.sequence_key))
  const firstStep = seq?.steps[0]
  const waitDays = firstStep?.day ?? 0
  const scheduledAt = new Date(Date.now() + waitDays * 86_400_000).toISOString()

  const now = new Date().toISOString()

  // Crea run + scheduled email (cron invierà — nessun invio immediato qui = HITL)
  let runId: string | null = null
  try {
    const { data: run, error: runErr } = await supabase
      .from('sequence_runs')
      .insert({
        user_id: user.id,
        sequence_id: null,
        sequence_name: `outbound:${item.sequence_key}`,
        recipient_email: recipientEmail,
        recipient_name: item.lead_name,
        sender_email: senderEmail,
        sender_name: senderName,
        status: 'active',
        steps_total: seq?.steps.length ?? 1,
        steps_sent: 0,
      })
      .select('id')
      .single()

    if (!runErr && run?.id) {
      runId = run.id
      await supabase.from('scheduled_emails').insert({
        user_id: user.id,
        run_id: run.id,
        step_index: 1,
        subject,
        body: emailBody,
        recipient_email: recipientEmail,
        sender_email: senderEmail,
        sender_name: senderName,
        scheduled_at: scheduledAt,
        status: 'pending',
      })
    }
  } catch {
    /* sequence_runs opzionale — approvazione comunque valida */
  }

  const { data: updated, error: updErr } = await supabase
    .from('outbound_queue')
    .update({
      status: runId ? 'scheduled' : 'approved',
      selected_variant: selectedVariant,
      subject,
      body: emailBody,
      sender_email: senderEmail,
      sender_name: senderName,
      scheduled_at: scheduledAt,
      approved_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    item: updated,
    runId,
    scheduledAt,
    message: runId
      ? 'Email approvata e schedulata — verrà inviata dal dispatcher'
      : 'Email approvata — configura sequence_runs per invio automatico',
  })
}
