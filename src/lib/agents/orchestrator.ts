import type { SupabaseClient } from '@supabase/supabase-js'
import { PRESET_PIPELINES, getAgentDescriptor, listAgentIds } from './registry.ts'
import type { AgentId, AgentRunResult, OrchestratorPipeline } from './types.ts'

export type OrchestratorContext = {
  supabase?: SupabaseClient
  userId?: string
}

export { PRESET_PIPELINES }

export async function runAgent(
  agentId: AgentId,
  input: Record<string, unknown>,
  ctx: OrchestratorContext = {},
): Promise<AgentRunResult> {
  try {
    switch (agentId) {
      case 'search': {
        const { runSearchAgent } = await import('./search-agent.ts')
        const data = await runSearchAgent({
          query: String(input.query ?? ''),
          mode: (input.mode as 'nlp' | 'semantic' | 'expand') || 'nlp',
        })
        if (!data.ok) return { agent: 'search', status: 'error', error: data.error }
        return { agent: 'search', status: 'success', data }
      }

      case 'audit': {
        const { runAuditResumeBatch } = await import('./audit-agent.ts')
        const results = Array.isArray(input.results)
          ? (input.results as Record<string, unknown>[])
          : []
        const data = await runAuditResumeBatch({
          jobId: String(input.jobId ?? input.job_id ?? ''),
          results,
          batchSize: Number(input.batchSize ?? input.batch_size) || 3,
          jobStatus: typeof input.jobStatus === 'string' ? input.jobStatus : undefined,
        })
        return { agent: 'audit', status: 'success', data }
      }

      case 'pitch': {
        const { runPitchAgent } = await import('./pitch-agent.ts')
        const data = await runPitchAgent(input as Parameters<typeof runPitchAgent>[0])
        return { agent: 'pitch', status: 'success', data }
      }

      case 'outreach': {
        const { checkOutreachGuardrails, validateOutreachChannel } = await import('./outreach-agent.ts')
        const channel = String(input.channel ?? '')
        if (!validateOutreachChannel(channel)) {
          return { agent: 'outreach', status: 'error', error: 'Canale non valido' }
        }
        const guard = checkOutreachGuardrails({
          channel,
          dailySentCount: Number(input.dailySentCount) || 0,
          daysSinceLastContact:
            input.daysSinceLastContact === null || input.daysSinceLastContact === undefined
              ? null
              : Number(input.daysSinceLastContact),
        })
        return {
          agent: 'outreach',
          status: guard.allowed ? 'success' : 'error',
          data: guard,
          error: guard.allowed ? undefined : guard.reason,
        }
      }

      case 'insights': {
        if (!ctx.supabase || !ctx.userId) {
          return { agent: 'insights', status: 'error', error: 'Contesto utente richiesto' }
        }
        const { runInsightsAgent } = await import('./insights-agent.ts')
        const data = await runInsightsAgent(ctx.supabase, {
          userId: ctx.userId,
          knowledgeQuery: typeof input.knowledgeQuery === 'string' ? input.knowledgeQuery : undefined,
        })
        return { agent: 'insights', status: 'success', data }
      }

      case 'universe': {
        const { runUniverseAgent } = await import('./universe-agent.ts')
        const data = await runUniverseAgent({
          action: input.action as 'twin' | 'agentic_search' | 'resolve_domain' | undefined,
          entity_id: typeof input.entity_id === 'string' ? input.entity_id : undefined,
          domain: typeof input.domain === 'string' ? input.domain : undefined,
          user_query: typeof input.user_query === 'string' ? input.user_query : undefined,
          city: typeof input.city === 'string' ? input.city : undefined,
          limit: Number(input.limit) || undefined,
          signal_intent: input.signal_intent as import('@/lib/signal-intent/types').SignalIntentSpec | undefined,
          userId: ctx.userId,
        })
        if (!data.ok) return { agent: 'universe', status: 'error', error: data.error }
        return { agent: 'universe', status: 'success', data }
      }

      case 'orchestrator': {
        const pipeline = Array.isArray(input.pipeline) ? (input.pipeline as AgentId[]) : []
        const nested = await runPipeline(pipeline, input.input as Record<string, unknown>, ctx)
        return { agent: 'orchestrator', status: 'success', data: nested }
      }

      default:
        return { agent: agentId, status: 'error', error: 'Agente sconosciuto' }
    }
  } catch (e: unknown) {
    return {
      agent: agentId,
      status: 'error',
      error: e instanceof Error ? e.message : 'Agent run failed',
    }
  }
}

export async function runPipeline(
  pipeline: OrchestratorPipeline,
  input: Record<string, unknown>,
  ctx: OrchestratorContext = {},
): Promise<AgentRunResult[]> {
  const steps = pipeline.filter((id) => id !== 'orchestrator')
  const results: AgentRunResult[] = []
  let carry = { ...input }

  for (const step of steps) {
    const result = await runAgent(step, carry, ctx)
    results.push(result)
    if (result.status !== 'success') break
    if (result.data && typeof result.data === 'object') {
      carry = { ...carry, ...(result.data as Record<string, unknown>) }
    }
  }

  return results
}

export function listAgents() {
  return listAgentIds().map((id) => getAgentDescriptor(id)).filter(Boolean)
}
