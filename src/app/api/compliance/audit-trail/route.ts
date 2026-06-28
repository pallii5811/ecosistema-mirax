import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { AI_ACT_DISCLAIMER } from '@/lib/ai-act-audit'

/**
 * GET /api/compliance/audit-trail
 * Export AI Act trail: ai_audit_trail + outreach con rationale.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))
  const type = req.nextUrl.searchParams.get('type')

  let trailQ = supabase
    .from('ai_audit_trail')
    .select('id, decision_type, entity_ref, rationale, inputs, outputs, model, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (type) trailQ = trailQ.eq('decision_type', type)

  const { data: trail, error: trailErr } = await trailQ

  if (trailErr && !/does not exist/i.test(trailErr.message)) {
    return NextResponse.json({ error: trailErr.message }, { status: 500 })
  }

  const { data: outreach } = await supabase
    .from('outreach_log')
    .select('id, lead_name, lead_website, channel, status, rationale, message, created_at')
    .eq('user_id', user.id)
    .not('rationale', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  return NextResponse.json({
    disclaimer: AI_ACT_DISCLAIMER,
    trail: trail ?? [],
    outreach_with_rationale: outreach ?? [],
    enabled: !trailErr,
  })
}
