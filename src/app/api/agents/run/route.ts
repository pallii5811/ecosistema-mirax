import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { runAgent, runPipeline } from '@/lib/agents/orchestrator'
import type { AgentId } from '@/lib/agents/types'

/**
 * POST /api/agents/run
 * Body: { agent: AgentId, input?: object, pipeline?: AgentId[] }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    agent?: string
    input?: Record<string, unknown>
    pipeline?: string[]
  } | null

  const input = body?.input && typeof body.input === 'object' ? body.input : {}
  const ctx = { supabase, userId: user.id }

  if (Array.isArray(body?.pipeline) && body.pipeline.length > 0) {
    const pipeline = body.pipeline.filter((id): id is AgentId =>
      ['search', 'audit', 'pitch', 'outreach', 'insights'].includes(id),
    )
    const results = await runPipeline(pipeline, input, ctx)
    return NextResponse.json({ pipeline, results })
  }

  const agent = String(body?.agent ?? '').trim() as AgentId
  if (!agent) return NextResponse.json({ error: 'agent o pipeline richiesto' }, { status: 400 })

  const result = await runAgent(agent, input, ctx)
  const status = result.status === 'error' ? 400 : 200
  return NextResponse.json(result, { status })
}
