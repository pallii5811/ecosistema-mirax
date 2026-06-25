import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * GET/POST /api/cron/sequences-dispatch
 *
 * Dispatcher delle email schedulate. Da chiamare periodicamente (ogni minuto
 * o ogni ora) tramite Vercel Cron o cron esterno.
 *
 * Autenticazione: Header `Authorization: Bearer ${CRON_SECRET}`.
 * Se CRON_SECRET non è definito, l'endpoint richiede comunque un Bearer e
 * lo confronta con SUPABASE_SERVICE_ROLE_KEY (fallback).
 *
 * Logica:
 *  1. Trova scheduled_emails con status='pending' e scheduled_at <= now
 *     che appartengono a run con status='active'
 *  2. Per ognuna invia via Resend
 *  3. Aggiorna status, sent_at, resend_id (o error_message)
 *  4. Quando l'ultima email di un run viene inviata, marca run.completed_at
 *
 * Configurazione Vercel Cron (opzionale, aggiungi in vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/sequences-dispatch", "schedule": "*\/15 * * * *" }
 *     ]
 *   }
 */

const BATCH_SIZE = 50

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
    if (!res.ok) return { ok: false, error: data?.message || `Resend HTTP ${res.status}` }
    return { ok: true, id: data?.id }
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Timeout Resend' : err?.message || 'Errore Resend' }
  }
}

async function handler(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const cronSecret = process.env.CRON_SECRET || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  const expected = cronSecret || serviceRoleKey
  if (!expected || bearer !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: 'Supabase env mancante' }, { status: 500 })
  }
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return NextResponse.json({ ok: false, error: 'RESEND_API_KEY mancante' }, { status: 500 })
  }

  const supabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const now = new Date().toISOString()

  // Trova email pending dovute, di run attivi
  const { data: dueEmails, error: fetchErr } = await supabase
    .from('scheduled_emails')
    .select('id, user_id, run_id, step_index, subject, body, recipient_email, sender_email, sender_name')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchErr) {
    if (/relation .* does not exist/i.test(fetchErr.message)) {
      return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0, tableMissing: true })
    }
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  }

  if (!dueEmails || dueEmails.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0 })
  }

  // Filtra: solo email con run attivo (non paused/cancelled)
  const runIds = Array.from(new Set(dueEmails.map((e: any) => e.run_id)))
  const { data: activeRuns } = await supabase
    .from('sequence_runs')
    .select('id, status, steps_total, steps_sent')
    .in('id', runIds)

  const activeRunMap = new Map<string, any>()
  for (const r of activeRuns ?? []) {
    if ((r as any).status === 'active') activeRunMap.set((r as any).id, r)
  }

  const emailsToSend = dueEmails.filter((e: any) => activeRunMap.has(e.run_id))

  let sent = 0
  let failed = 0
  const runUpdates = new Map<string, number>()

  for (const e of emailsToSend) {
    const fromHeader = (e as any).sender_name
      ? `${(e as any).sender_name} <${(e as any).sender_email}>`
      : (e as any).sender_email

    const result = await sendViaResend({
      apiKey: resendKey,
      from: fromHeader,
      to: (e as any).recipient_email,
      subject: (e as any).subject,
      htmlBody: textToHtml((e as any).body),
    })

    if (result.ok) {
      await supabase
        .from('scheduled_emails')
        .update({ status: 'sent', resend_id: result.id || null, sent_at: new Date().toISOString() })
        .eq('id', (e as any).id)
      sent++
      runUpdates.set((e as any).run_id, (runUpdates.get((e as any).run_id) || 0) + 1)
    } else {
      await supabase
        .from('scheduled_emails')
        .update({ status: 'failed', error_message: result.error || 'Errore invio' })
        .eq('id', (e as any).id)
      failed++
    }
  }

  // Aggiorna contatori run + segna completati
  for (const [runId, increment] of runUpdates.entries()) {
    const r = activeRunMap.get(runId)
    const newSent = (r?.steps_sent || 0) + increment
    const total = r?.steps_total || 0
    const update: Record<string, unknown> = { steps_sent: newSent }
    if (total > 0 && newSent >= total) {
      update.status = 'completed'
      update.completed_at = new Date().toISOString()
    }
    await supabase.from('sequence_runs').update(update).eq('id', runId)
  }

  return NextResponse.json({
    ok: true,
    processed: emailsToSend.length,
    sent,
    failed,
    skipped: dueEmails.length - emailsToSend.length,
  })
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
