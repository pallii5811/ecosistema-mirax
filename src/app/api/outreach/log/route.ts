import { createClient } from '@/utils/supabase/server'

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
      }
    | null

  const channel = typeof body?.channel === 'string' ? body.channel.trim().toLowerCase() : ''
  if (!CHANNELS.has(channel)) {
    return Response.json({ error: 'Canale non valido' }, { status: 400 })
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

  return Response.json({ ok: true, id: data?.id ?? null })
}
