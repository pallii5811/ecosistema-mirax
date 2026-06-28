import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { listAgents, PRESET_PIPELINES } from '@/lib/agents/orchestrator'

/**
 * GET /api/agents — registry agenti MIRAX.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  return NextResponse.json({
    agents: listAgents(),
    presets: PRESET_PIPELINES,
  })
}
