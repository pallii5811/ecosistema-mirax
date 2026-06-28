import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { loadInsightsSnapshot } from '@/lib/insights-data'

/**
 * GET /api/insights/stats
 * Metriche reali: pipeline + outreach (no mock da lead_interactions).
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const snapshot = await loadInsightsSnapshot(supabase, user.id)
  const { pipeline, outreach } = snapshot

  return NextResponse.json({
    total_contacted: outreach.contacted,
    total_converted: pipeline.won,
    total_rejected: pipeline.lost,
    conversion_rate: pipeline.winRate,
    outreach_response_rate: outreach.responseRate,
    outreach_interest_rate: outreach.interestRate,
    pipeline_active: pipeline.active,
    pipeline_stagnant: pipeline.stagnant,
    total_revenue: pipeline.totalRevenue,
    pipeline_value: pipeline.pipelineValue,
    avg_deal_size: Math.round(pipeline.avgDealSize),
    avg_lead_score: pipeline.avgScore,
    pki_score: snapshot.pki.score,
    pki_grade: snapshot.pki.grade,
    closure_patterns: snapshot.closurePatterns.slice(0, 5),
    source: 'pipeline_outreach',
  })
}
