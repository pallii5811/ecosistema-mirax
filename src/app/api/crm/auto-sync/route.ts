import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { syncLeadToActiveCrm } from '@/lib/crm/hub'

/**
 * POST /api/crm/auto-sync — sync lead verso CRM attivo (Intent >= 60 + toggle ON)
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body?.lead || typeof body.lead !== 'object') {
    return NextResponse.json({ ok: false, error: 'lead obbligatorio' }, { status: 400 })
  }

  const lead = body.lead as Record<string, unknown>
  const intentScore = typeof body.intentScore === 'number' ? body.intentScore : undefined

  const result = await syncLeadToActiveCrm(user.id, lead, { intentScore })

  if (result.skipped) {
    return NextResponse.json({ ok: false, skipped: true, reason: result.reason })
  }

  return NextResponse.json(result)
}
