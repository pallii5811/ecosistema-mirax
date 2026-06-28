import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { emitMiraxEvent } from '@/lib/events/emit'
import { syncPipelineFromOutreach } from '@/lib/pipeline-sync'
import { recordOutreachScoringFeedback } from '@/lib/scoring-feedback'
import { checkOutreachGuardrails } from '@/lib/agents/outreach-agent'
import { daysSince } from '@/lib/outreach'
import { buildOutreachAuditRecord } from '@/lib/ai-act-audit'

// POST /api/outreach/log — record a single outreach action (audit trail).
// Body: { leadId?, website?, name?, channel, message?, mode?, status? }
// Best-effort: if the outreach_log table is missing, returns ok:false with needsMigration.

const CHANNELS = new Set(['whatsapp', 'email', 'telegram', 'linkedin', 'call', 'other'])
const STATUSES = new Set(['queued', 'sent', 'replied', 'interested', 'not_interested', 'no_answer', 'skipped', 'failed'])
const MODES = new Set(['sell_service', 'mirax_promo'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeWebsite(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase().replace(/\/+$/, '')
  return trimmed || null
}

function isMissingTable(message: string | undefined): boolean {
  if (!message) return false
  return /outreach_log/i.test(message) && /(does not exist|relation|schema cache|could not find)/i.test(message)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | {
        leadId?: string
        website?: string
        name?: string
        channel?: string
        message?: string
        rationale?: string
        mode?: string
        status?: string
        leadScore?: number
        leadPhone?: string
        leadEmail?: string
        leadCity?: string
        leadCategory?: string
      }
    | null

  const channel = typeof body?.channel === 'string' ? body.channel.trim().toLowerCase() : ''
  if (!CHANNELS.has(channel)) {
    return Response.json({ error: 'Canale non valido' }, { status: 400 })
  }

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const { count: dailyCount } = await supabase
    .from('outreach_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', startOfDay.toISOString())

  const website = normalizeWebsite(body?.website)
  let daysSinceContact: number | null = null
  if (website) {
    const { data: lastRow } = await supabase
      .from('outreach_log')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('lead_website', website)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    daysSinceContact = daysSince(lastRow?.created_at)
  }

  const guard = checkOutreachGuardrails({
    channel,
    dailySentCount: dailyCount ?? 0,
    daysSinceLastContact: daysSinceContact,
  })

  if (!guard.allowed) {
    return Response.json({ ok: false, error: guard.reason, guardrail: guard }, { status: 429 })
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    channel,
    lead_website: normalizeWebsite(body?.website),
    lead_name: typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null,
    message: typeof body?.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 4000) : null,
    rationale: typeof body?.rationale === 'string' && body.rationale.trim() ? body.rationale.trim().slice(0, 600) : null,
    status: typeof body?.status === 'string' && STATUSES.has(body.status) ? body.status : 'sent',
    mode: typeof body?.mode === 'string' && MODES.has(body.mode) ? body.mode : 'sell_service',
  }
  if (typeof body?.leadId === 'string' && UUID_RE.test(body.leadId)) {
    row.lead_id = body.leadId
  }

  const { data, error } = await supabase.from('outreach_log').insert(row).select('id').maybeSingle()

  if (error) {
    if (isMissingTable(error.message)) {
      return Response.json({ ok: false, needsMigration: true }, { status: 200 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  try {
    const service = createServiceRoleClient()
    await emitMiraxEvent(service, {
      userId: user.id,
      eventType: 'outreach.sent',
      payload: {
        outreach_id: data?.id ?? null,
        lead_id: row.lead_id ?? null,
        lead_name: row.lead_name,
        website: row.lead_website,
        channel: row.channel,
        status: row.status,
      },
    })
  } catch {
    /* non-blocking */
  }

  let pipelineSync: Record<string, unknown> | null = null
  try {
    const sync = await syncPipelineFromOutreach(supabase, user.id, {
      outreachId: data?.id ?? null,
      leadName: row.lead_name as string | null,
      leadWebsite: row.lead_website as string | null,
      channel,
      status: row.status as string,
      leadScore: typeof body?.leadScore === 'number' ? body.leadScore : null,
      leadPhone: body?.leadPhone ?? null,
      leadEmail: body?.leadEmail ?? null,
      leadCity: body?.leadCity ?? null,
      leadCategory: body?.leadCategory ?? null,
    })
    pipelineSync = sync
  } catch {
    /* non-blocking */
  }

  try {
    await recordOutreachScoringFeedback(supabase, user.id, {
      website: row.lead_website as string | null,
      name: row.lead_name as string | null,
      status: row.status as string,
      scoreAtTime: typeof body?.leadScore === 'number' ? body.leadScore : null,
    })
  } catch {
    /* non-blocking */
  }

  try {
    const auditRec = buildOutreachAuditRecord({
      channel,
      status: String(row.status),
      mode: String(row.mode),
      message: row.message as string | null,
      rationale: row.rationale as string | null,
      lead_name: row.lead_name as string | null,
      lead_website: row.lead_website as string | null,
    })
    await supabase.from('ai_audit_trail').insert({
      user_id: user.id,
      ...auditRec,
    })
  } catch {
    /* table may not exist yet */
  }

  return Response.json({
    ok: true,
    id: data?.id ?? null,
    pipeline: pipelineSync,
    guardrail: guard.severity !== 'ok' ? guard : undefined,
  })
}
