import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * POST /api/sequences/[id]/launch
 * Lancia una sequenza salvata come campagna verso un destinatario.
 *
 * Crea:
 *  - 1 record in `sequence_runs` (tracking della campagna)
 *  - N record in `scheduled_emails` (uno per ogni step)
 *
 * Per il primo step (waitDays = 0) tenta l'invio immediato via Resend.
 * Gli altri restano in `scheduled_emails` con status 'pending' e vengono
 * processati dal cron /api/cron/sequences-dispatch.
 *
 * SCHEMA RICHIESTO (applicare una volta nel SQL Editor Supabase):
 *
 *   CREATE TABLE IF NOT EXISTS sequence_runs (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     sequence_id UUID,
 *     sequence_name TEXT NOT NULL,
 *     recipient_email TEXT NOT NULL,
 *     recipient_name TEXT,
 *     sender_email TEXT NOT NULL,
 *     sender_name TEXT,
 *     status TEXT NOT NULL DEFAULT 'active',
 *     steps_total INT NOT NULL DEFAULT 0,
 *     steps_sent INT NOT NULL DEFAULT 0,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     completed_at TIMESTAMPTZ
 *   );
 *
 *   CREATE TABLE IF NOT EXISTS scheduled_emails (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     run_id UUID NOT NULL REFERENCES sequence_runs(id) ON DELETE CASCADE,
 *     step_index INT NOT NULL,
 *     subject TEXT NOT NULL,
 *     body TEXT NOT NULL,
 *     recipient_email TEXT NOT NULL,
 *     sender_email TEXT NOT NULL,
 *     sender_name TEXT,
 *     scheduled_at TIMESTAMPTZ NOT NULL,
 *     status TEXT NOT NULL DEFAULT 'pending',
 *     resend_id TEXT,
 *     error_message TEXT,
 *     sent_at TIMESTAMPTZ,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 *   CREATE INDEX IF NOT EXISTS idx_scheduled_emails_dispatch
 *     ON scheduled_emails(status, scheduled_at) WHERE status = 'pending';
 *   CREATE INDEX IF NOT EXISTS idx_sequence_runs_user
 *     ON sequence_runs(user_id, created_at DESC);
 *
 *   ALTER TABLE sequence_runs ENABLE ROW LEVEL SECURITY;
 *   ALTER TABLE scheduled_emails ENABLE ROW LEVEL SECURITY;
 *
 *   CREATE POLICY "users own runs" ON sequence_runs
 *     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
 *   CREATE POLICY "users own scheduled" ON scheduled_emails
 *     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
 *
 * Body: { recipientEmail, recipientName?, senderEmail, senderName? }
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function textToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0;line-height:1.55;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

async function sendViaResend(payload: {
  apiKey: string
  from: string
  to: string
  subject: string
  htmlBody: string
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.htmlBody,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, error: data?.message || `Resend HTTP ${res.status}` }
    }
    return { ok: true, id: data?.id }
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Timeout Resend' : err?.message || 'Errore Resend' }
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id: sequenceId } = await params
  if (!UUID_RE.test(sequenceId)) {
    return NextResponse.json({ ok: false, error: 'ID sequenza non valido' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as
    | { recipientEmail?: string; recipientName?: string; senderEmail?: string; senderName?: string }
    | null

  const recipientEmail = (body?.recipientEmail || '').trim()
  const senderEmail = (body?.senderEmail || '').trim()
  const recipientName = (body?.recipientName || '').trim() || null
  const senderName = (body?.senderName || '').trim() || null

  if (!EMAIL_RE.test(recipientEmail)) {
    return NextResponse.json({ ok: false, error: 'Email destinatario non valida' }, { status: 400 })
  }
  if (!EMAIL_RE.test(senderEmail)) {
    return NextResponse.json({ ok: false, error: 'Email mittente non valida' }, { status: 400 })
  }

  // 1. Recupera sequenza
  let seqRecord: any = null
  try {
    const { data, error } = await supabase
      .from('sequences')
      .select('id, name, steps, company_name')
      .eq('id', sequenceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json(
          { ok: false, tableMissing: true, error: 'Tabella sequences non configurata' },
          { status: 503 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ ok: false, error: 'Sequenza non trovata' }, { status: 404 })
    seqRecord = data
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Errore lettura sequenza' }, { status: 500 })
  }

  const steps = Array.isArray(seqRecord.steps) ? seqRecord.steps : []
  if (steps.length === 0) {
    return NextResponse.json({ ok: false, error: 'La sequenza non ha email da inviare' }, { status: 400 })
  }

  // 2. Crea sequence_run
  let runRecord: any = null
  try {
    const { data, error } = await supabase
      .from('sequence_runs')
      .insert({
        user_id: user.id,
        sequence_id: sequenceId,
        sequence_name: seqRecord.name,
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        sender_email: senderEmail,
        sender_name: senderName,
        status: 'active',
        steps_total: steps.length,
        steps_sent: 0,
      })
      .select('*')
      .single()
    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json(
          { ok: false, tableMissing: true, error: 'Tabelle sequence_runs/scheduled_emails non configurate' },
          { status: 503 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    runRecord = data
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Errore creazione run' }, { status: 500 })
  }

  // 3. Crea scheduled_emails (uno per step)
  const now = Date.now()
  const scheduledRows = steps.map((s: any, idx: number) => {
    const waitDays = Number(s?.waitDays) || 0
    const scheduledAt = new Date(now + Math.max(0, waitDays) * 86_400_000).toISOString()
    return {
      user_id: user.id,
      run_id: runRecord.id,
      step_index: typeof s?.step === 'number' ? s.step : idx + 1,
      subject: typeof s?.subject === 'string' ? s.subject : `Email ${idx + 1}`,
      body: typeof s?.body === 'string' ? s.body : '',
      recipient_email: recipientEmail,
      sender_email: senderEmail,
      sender_name: senderName,
      scheduled_at: scheduledAt,
      status: 'pending' as const,
    }
  })

  let inserted: any[] = []
  try {
    const { data, error } = await supabase.from('scheduled_emails').insert(scheduledRows).select('*')
    if (error) {
      // Rollback del run se l'inserimento step fallisce
      await supabase.from('sequence_runs').delete().eq('id', runRecord.id)
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json(
          { ok: false, tableMissing: true, error: 'Tabella scheduled_emails non configurata' },
          { status: 503 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    inserted = Array.isArray(data) ? data : []
  } catch (e: any) {
    await supabase.from('sequence_runs').delete().eq('id', runRecord.id)
    return NextResponse.json({ ok: false, error: e?.message || 'Errore creazione email' }, { status: 500 })
  }

  // 4. Prima email (step con waitDays = 0): invia subito via Resend se chiave disponibile
  const apiKey = process.env.RESEND_API_KEY
  let firstSent = false
  let firstError: string | null = null

  const firstEmail = inserted.find((e) => {
    const ms = new Date(e.scheduled_at).getTime()
    return ms <= now + 60_000 // entro 60s dall'invio = "subito"
  })

  if (firstEmail && apiKey) {
    const fromHeader = senderName ? `${senderName} <${senderEmail}>` : senderEmail
    const result = await sendViaResend({
      apiKey,
      from: fromHeader,
      to: recipientEmail,
      subject: firstEmail.subject,
      htmlBody: textToHtml(firstEmail.body),
    })

    if (result.ok) {
      firstSent = true
      await supabase
        .from('scheduled_emails')
        .update({ status: 'sent', resend_id: result.id || null, sent_at: new Date().toISOString() })
        .eq('id', firstEmail.id)
      await supabase
        .from('sequence_runs')
        .update({ steps_sent: 1 })
        .eq('id', runRecord.id)
    } else {
      firstError = result.error || 'Errore invio'
      await supabase
        .from('scheduled_emails')
        .update({ status: 'failed', error_message: firstError })
        .eq('id', firstEmail.id)
    }
  }

  return NextResponse.json({
    ok: true,
    runId: runRecord.id,
    stepsTotal: steps.length,
    firstSent,
    firstError,
    pendingCount: steps.length - (firstSent ? 1 : 0),
    resendConfigured: !!apiKey,
  })
}
