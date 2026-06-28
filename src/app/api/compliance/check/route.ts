import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { checkOutreachCompliance } from '@/lib/compliance/registro-opposizioni'
import type { ComplianceChannel } from '@/lib/compliance/types'
import { buildComplianceAuditRecord } from '@/lib/ai-act-audit'

const CHANNELS = new Set<ComplianceChannel>(['email', 'phone', 'whatsapp'])

function isMissingTable(message: string | undefined): boolean {
  if (!message) return false
  return /compliance_checks/i.test(message) && /(does not exist|relation|schema cache|could not find)/i.test(message)
}

/** POST /api/compliance/check — verifica Registro Opposizioni / GDPR */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    channel?: string
    target?: string
    email?: string
    phone?: string
    logBasis?: boolean
  } | null

  const channel = typeof body?.channel === 'string' ? body.channel.trim().toLowerCase() as ComplianceChannel : null
  if (!channel || !CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'Canale non valido' }, { status: 400 })
  }

  const target =
    typeof body?.target === 'string' && body.target.trim()
      ? body.target.trim()
      : channel === 'email'
        ? body?.email?.trim() || ''
        : body?.phone?.trim() || ''

  if (!target) {
    return NextResponse.json({ error: 'Target mancante' }, { status: 400 })
  }

  const result = await checkOutreachCompliance({
    channel,
    email: channel === 'email' ? target : undefined,
    phone: channel !== 'email' ? target : undefined,
  })

  if (!result) {
    return NextResponse.json({ error: 'Impossibile eseguire il check' }, { status: 400 })
  }

  const svc = createServiceRoleClient()
  const { error: insertError } = await svc.from('compliance_checks').insert({
    user_id: user.id,
    channel: result.channel,
    target: result.target,
    check_type: result.checkType,
    status: result.status,
    raw_response: result.raw ?? null,
    checked_at: result.checkedAt,
  })

  const needsMigration = insertError ? isMissingTable(insertError.message) : false

  if (body?.logBasis && result.status === 'clear') {
    try {
      await svc.from('ai_audit_trail').insert(buildComplianceAuditRecord({
        userId: user.id,
        channel: result.channel,
        target: result.target,
        status: result.status,
      }))
    } catch {
      /* best-effort */
    }
  }

  return NextResponse.json({
    ...result,
    uiStatus: result.status === 'clear' ? 'verified' : result.status === 'blocked' ? 'blocked' : result.status === 'manual_review' ? 'manual_review' : 'unknown',
    persisted: !insertError,
    needsMigration,
  })
}

/** GET /api/compliance/check — storico recente per target */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const target = req.nextUrl.searchParams.get('target')?.trim()
  const channel = req.nextUrl.searchParams.get('channel')?.trim().toLowerCase()

  const svc = createServiceRoleClient()
  let query = svc
    .from('compliance_checks')
    .select('*')
    .eq('user_id', user.id)
    .order('checked_at', { ascending: false })
    .limit(50)

  if (target) query = query.ilike('target', `%${target}%`)
  if (channel) query = query.eq('channel', channel)

  const { data, error } = await query

  if (error && isMissingTable(error.message)) {
    return NextResponse.json({ checks: [], needsMigration: true })
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ checks: data ?? [] })
}
