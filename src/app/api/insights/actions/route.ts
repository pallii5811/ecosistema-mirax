import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/insights/actions
 *
 * Restituisce azioni concrete da fare ORA, calcolate dai dati pipeline:
 *  - Deal fermi da >7 giorni in stage non-finale (rischio perdita)
 *  - Deal in "Proposta" non aggiornati da >3 giorni (urgenza chiusura)
 *  - Lead "Nuovo" con score >= 70 mai contattati (HOT da lavorare)
 *  - Deal in "Meeting" non avanzati a "Proposta" in >5 giorni
 *
 * E un forecast del mese:
 *  - Revenue prevista = (pipeline_value * win_rate / 100)
 *  - Deal a rischio chiusura entro fine mese
 */

type Action = {
  type: 'stagnant' | 'urgent_proposal' | 'hot_uncontacted' | 'meeting_followup'
  severity: 'critical' | 'warning' | 'info'
  title: string
  body: string
  cta: { label: string; href: string }
  count: number
  examples: string[] // primi nomi lead per dare contesto
}

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
    won.length + lost.length > 0
      ? Math.round((won.length / (won.length + lost.length)) * 100)
      : 0

  // --- ACTIONS ---
  const actions: Action[] = []

  // 1. Stagnant deals (>7 giorni in stage attivo)
  const stagnant = active.filter((p: any) => {
    const days = (now - new Date(p.updated_at).getTime()) / DAY
    return days > 7
  })
  if (stagnant.length > 0) {
    actions.push({
      type: 'stagnant',
      severity: stagnant.length >= 3 ? 'critical' : 'warning',
      title: `${stagnant.length} deal fermi da oltre 7 giorni`,
      body: `Questi deal stanno perdendo calore. Riattivali oggi con una sequenza email o una chiamata, altrimenti il ${Math.round(60 - winRate * 0.3)}% rischia di scivolare in "Perso".`,
      cta: { label: 'Vai alla Pipeline', href: '/dashboard/pipeline' },
      count: stagnant.length,
      examples: stagnant.slice(0, 3).map((p: any) => p.lead_name),
    })
  }

  // 2. Proposta non aggiornata da >3 giorni
  const urgentProposals = active.filter((p: any) => {
    if (p.stage !== 'proposta') return false
    const days = (now - new Date(p.updated_at).getTime()) / DAY
    return days > 3
  })
  if (urgentProposals.length > 0) {
    actions.push({
      type: 'urgent_proposal',
      severity: 'critical',
      title: `${urgentProposals.length} proposta${urgentProposals.length > 1 ? 'e' : ''} in attesa di risposta`,
      body: 'Una proposta che resta senza follow-up oltre 3 giorni perde il 50% di probabilità di chiusura. Chiama oggi.',
      cta: { label: 'Apri Pipeline → Proposta', href: '/dashboard/pipeline' },
      count: urgentProposals.length,
      examples: urgentProposals.slice(0, 3).map((p: any) => p.lead_name),
    })
  }

  // 3. HOT lead (score >=70) mai contattati
  const hotUncontacted = active.filter((p: any) => p.stage === 'nuovo' && Number(p.lead_score) >= 70)
  if (hotUncontacted.length > 0) {
    actions.push({
      type: 'hot_uncontacted',
      severity: 'warning',
      title: `${hotUncontacted.length} lead HOT mai contattati`,
      body: `Lead con score 70+ hanno 3x più probabilità di chiusura. Stai lasciando potenziali ${Math.round(hotUncontacted.length * 0.3)} clienti sul tavolo.`,
      cta: { label: 'Apri Lead Hotlist', href: '/dashboard/stats' },
      count: hotUncontacted.length,
      examples: hotUncontacted.slice(0, 3).map((p: any) => p.lead_name),
    })
  }

  // 4. Meeting fatti ma non avanzati a Proposta in >5 giorni
  const meetingNoFollow = active.filter((p: any) => {
    if (p.stage !== 'meeting') return false
    const days = (now - new Date(p.updated_at).getTime()) / DAY
    return days > 5
  })
  if (meetingNoFollow.length > 0) {
    actions.push({
      type: 'meeting_followup',
      severity: 'info',
      title: `${meetingNoFollow.length} meeting senza proposta inviata`,
      body: 'Il momento migliore per mandare una proposta è entro 48h dal meeting. Più aspetti, più freddezza.',
      cta: { label: 'Vai alla Pipeline', href: '/dashboard/pipeline' },
      count: meetingNoFollow.length,
      examples: meetingNoFollow.slice(0, 3).map((p: any) => p.lead_name),
    })
  }

  // Ordina per severity
  const severityOrder = { critical: 0, warning: 1, info: 2 }
  actions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  // --- FORECAST ---
  const effectiveWinRate = won.length + lost.length >= 3 ? winRate : 25 // se pochi dati usa media B2B
  const expectedRevenue = Math.round((pipelineValue * effectiveWinRate) / 100)
  const confidenceLevel: Forecast['confidenceLevel'] =
    won.length + lost.length >= 10 ? 'high' : won.length + lost.length >= 3 ? 'medium' : 'low'
  const dealsAtRisk = stagnant.length + urgentProposals.length

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
  })
}
