import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  buildEdatActions,
  buildPipelineActions,
  sortInsightActions,
  type InsightAction,
} from '@/lib/insights-action-rules'
import { leadFreshnessScore, parseSearchResults } from '@/lib/reaudit'

/**
 * GET /api/insights/actions — "Cosa fare ora" (pipeline + EDAT).
 */
type Forecast = {
  pipelineValue: number
  winRate: number
  expectedRevenue: number
  confidenceLevel: 'low' | 'medium' | 'high'
  dealsAtRisk: number
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ actions: [], forecast: null, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: items } = await supabase
    .from('lead_pipeline')
    .select('id, lead_name, stage, deal_value, lead_score, created_at, updated_at')
    .eq('user_id', user.id)
    .limit(500)

  const pipeline = Array.isArray(items) ? items : []
  const now = Date.now()
  const DAY = 86_400_000

  const won = pipeline.filter((p: any) => p.stage === 'vinto')
  const lost = pipeline.filter((p: any) => p.stage === 'perso')
  const active = pipeline.filter((p: any) => !['vinto', 'perso'].includes(p.stage))
  const pipelineValue = active.reduce((s: number, p: any) => s + (Number(p.deal_value) || 0), 0)
  const winRate =
    won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

  const pipelineActions = buildPipelineActions(pipeline as any[], now)

  // Meeting follow-up (non in buildPipelineActions)
  const meetingNoFollow = active.filter((p: any) => {
    if (p.stage !== 'meeting') return false
    const t = p.updated_at ? Date.parse(p.updated_at) : NaN
    return Number.isFinite(t) && (now - t) / DAY > 5
  })
  if (meetingNoFollow.length > 0) {
    pipelineActions.push({
      type: 'meeting_followup',
      severity: 'info',
      title: `${meetingNoFollow.length} meeting senza proposta inviata`,
      body: 'Manda proposta entro 48h dal meeting per massimizzare chiusura.',
      cta: { label: 'Vai alla Pipeline', href: '/dashboard/pipeline' },
      count: meetingNoFollow.length,
      examples: meetingNoFollow.slice(0, 3).map((p: any) => p.lead_name),
    })
  }

  // --- EDAT: stale leads, alerts, monitors, outreach, sequences ---
  let staleLeadCount = 0
  const staleExamples: string[] = []

  const { data: recentSearches } = await supabase
    .from('searches')
    .select('results')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(15)

  for (const row of recentSearches ?? []) {
    const leads = parseSearchResults((row as any).results)
    for (const lead of leads) {
      if (leadFreshnessScore(lead) < 50) {
        staleLeadCount++
        const name = String(lead.azienda ?? lead.nome ?? '').trim()
        if (name && staleExamples.length < 5) staleExamples.push(name)
      }
    }
  }

  const { count: unreadAlerts } = await supabase
    .from('lead_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  const { count: monitoredCount } = await supabase
    .from('lead_monitors')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const followUpCutoff = new Date(now - 3 * DAY).toISOString()
  const { data: staleOutreach } = await supabase
    .from('outreach_log')
    .select('lead_name')
    .eq('user_id', user.id)
    .eq('status', 'sent')
    .lt('created_at', followUpCutoff)
    .order('created_at', { ascending: false })
    .limit(50)

  const outreachFollowUpCount = Array.isArray(staleOutreach) ? staleOutreach.length : 0
  const outreachExamples = (staleOutreach ?? [])
    .map((r: any) => String(r.lead_name ?? '').trim())
    .filter(Boolean)

  const { count: pendingSequenceEmails } = await supabase
    .from('scheduled_emails')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending')

  const edatActions = buildEdatActions({
    staleLeadCount,
    staleExamples,
    unreadAlerts: unreadAlerts ?? 0,
    monitoredCount: monitoredCount ?? 0,
    outreachFollowUpCount,
    outreachExamples,
    pendingSequenceEmails: pendingSequenceEmails ?? 0,
  })

  const actions: InsightAction[] = sortInsightActions([...pipelineActions, ...edatActions])

  const stagnant = pipelineActions.find((a) => a.type === 'stagnant')
  const urgentProposals = pipelineActions.find((a) => a.type === 'urgent_proposal')
  const dealsAtRisk = (stagnant?.count ?? 0) + (urgentProposals?.count ?? 0)

  const effectiveWinRate = won.length + lost.length >= 3 ? winRate : 25
  const expectedRevenue = Math.round((pipelineValue * effectiveWinRate) / 100)
  const confidenceLevel: Forecast['confidenceLevel'] =
    won.length + lost.length >= 10 ? 'high' : won.length + lost.length >= 3 ? 'medium' : 'low'

  const forecast: Forecast = {
    pipelineValue,
    winRate: effectiveWinRate,
    expectedRevenue,
    confidenceLevel,
    dealsAtRisk,
  }

  return NextResponse.json({
    actions,
    forecast,
    totalActive: active.length,
    totalWon: won.length,
    totalLost: lost.length,
    edat: {
      staleLeadCount,
      unreadAlerts: unreadAlerts ?? 0,
      monitoredCount: monitoredCount ?? 0,
      outreachFollowUpCount,
      pendingSequenceEmails: pendingSequenceEmails ?? 0,
    },
  })
}
