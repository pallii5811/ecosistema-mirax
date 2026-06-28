import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getEnvironmentWithLeads } from '@/app/dashboard/environments/actions'
import { buildEnvironmentMesh } from '@/lib/environment-correlations'

/**
 * GET /api/insights/correlations?environment_id=...
 * Cross-meshing: correlazioni lead per ambiente.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const envId = req.nextUrl.searchParams.get('environment_id')

  if (envId) {
    const { environment, leads } = await getEnvironmentWithLeads(envId)
    if (!environment) return NextResponse.json({ error: 'Ambiente non trovato' }, { status: 404 })

    const mesh = buildEnvironmentMesh(leads)
    return NextResponse.json({
      environment_id: envId,
      environment_name: environment.name,
      ...mesh,
    })
  }

  const { data: envs } = await supabase
    .from('environments')
    .select('id, name, stats')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(20)

  const summaries = await Promise.all(
    (envs ?? []).map(async (env) => {
      const { leads } = await getEnvironmentWithLeads(env.id)
      const mesh = buildEnvironmentMesh(leads)
      return {
        environment_id: env.id,
        environment_name: env.name,
        totalLeads: mesh.totalLeads,
        top_signal: mesh.correlations[0] ?? null,
        categories: mesh.categories.slice(0, 3),
      }
    }),
  )

  return NextResponse.json({ environments: summaries })
}
