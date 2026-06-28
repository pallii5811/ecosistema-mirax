import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  collectSignalTypesFromLead,
  matchOutboundSequence,
} from '@/lib/outbound/sequences'
import { generateOutboundVariants } from '@/lib/outbound/ai-copywriter'
import { calculateIntentScoreFromLead } from '@/lib/scoring/intent-score'

/**
 * GET  /api/outbound/queue — lista coda HITL
 * POST /api/outbound/queue — enqueue da lead + segnale (genera 3 varianti AI)
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ items: [], error: 'Unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status') || 'pending_approval'

  const { data, error } = await supabase
    .from('outbound_queue')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    if (/does not exist/i.test(error.message)) {
      return NextResponse.json({ items: [], tableMissing: true })
    }
    return NextResponse.json({ items: [], error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, error: 'Body non valido' }, { status: 400 })

  const lead =
    body.lead && typeof body.lead === 'object' ? (body.lead as Record<string, unknown>) : body
  const companyName = String(lead.azienda || lead.nome || lead.name || lead.companyName || '').trim()
  if (!companyName) {
    return NextResponse.json({ ok: false, error: 'Nome azienda obbligatorio' }, { status: 400 })
  }

  const intentBreakdown = calculateIntentScoreFromLead(lead)
  const signalTypes = collectSignalTypesFromLead(lead)
  const triggerSignal = typeof body.trigger_signal_type === 'string'
    ? body.trigger_signal_type
    : signalTypes[0] || 'hiring'

  if (!signalTypes.includes(triggerSignal) && triggerSignal !== 'intent_hot') {
    signalTypes.push(triggerSignal)
  }

  const matched = matchOutboundSequence({
    signalTypes,
    intentScore: intentBreakdown.score,
  })

  if (!matched) {
    return NextResponse.json({
      ok: false,
      error: 'Nessuna sequenza outbound corrisponde a segnali/intent attuali',
      intentScore: intentBreakdown.score,
      signalTypes,
    }, { status: 422 })
  }

  const signalsForCopy = signalTypes.slice(0, 3).map((t) => ({
    type: t,
    title: `Segnale ${t}`,
  }))

  const { variants, model } = await generateOutboundVariants({
    companyName,
    personaName: typeof body.personaName === 'string' ? body.personaName : undefined,
    tone: (body.tone as 'formale' | 'casual' | 'professionale') || 'professionale',
    signals: signalsForCopy,
    templateKey: matched.steps[0]?.template,
  })

  const first = variants[0]
  const row = {
    user_id: user.id,
    lead_name: companyName,
    lead_website: String(lead.sito || lead.website || '').trim() || null,
    lead_email: String(lead.email || '').trim() || null,
    trigger_signal_type: triggerSignal,
    sequence_key: matched.key,
    intent_score: intentBreakdown.score,
    variants,
    selected_variant: first.label,
    subject: first.subject,
    body: first.body,
    status: 'pending_approval',
    signal_evidence: Array.isArray(lead.business_signals) ? lead.business_signals : [],
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase.from('outbound_queue').insert(row).select('*').single()

  if (error) {
    if (/does not exist/i.test(error.message)) {
      return NextResponse.json({ ok: false, tableMissing: true, error: error.message }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    item: data,
    sequence: matched,
    model,
    variants,
  })
}
