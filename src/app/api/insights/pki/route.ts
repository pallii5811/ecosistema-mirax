import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { loadInsightsSnapshot } from '@/lib/insights-data'

/**
 * GET /api/insights/pki
 * Performance Analysis Indicator — score composito da metriche reali.
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const snapshot = await loadInsightsSnapshot(supabase, user.id)

  return NextResponse.json({
    ...snapshot.pki,
    pipeline: snapshot.pipeline,
    outreach: snapshot.outreach,
    environments: snapshot.environments,
    knowledge: snapshot.knowledge,
    mesh_summary: {
      totalLeads: snapshot.mesh.totalLeads,
      top_signals: snapshot.mesh.correlations.slice(0, 4),
    },
  })
}
