import type { AgentDescriptor, AgentId } from './types.ts'

export const AGENT_REGISTRY: AgentDescriptor[] = [
  {
    id: 'search',
    label: 'Search Agent',
    description: 'NLP query → filtri deterministici + hybrid search',
    capabilities: ['nlp', 'semantic', 'expand'],
  },
  {
    id: 'audit',
    label: 'Audit Agent',
    description: 'Resume audit batch su job searches (worker fallback)',
    capabilities: ['resume_batch', 'merge_audit'],
  },
  {
    id: 'pitch',
    label: 'Pitch Agent',
    description: 'Genera subject/body email personalizzati',
    capabilities: ['email_pitch'],
  },
  {
    id: 'outreach',
    label: 'Outreach Agent',
    description: 'Guardrail canali, limiti giornalieri, anti-duplicato',
    capabilities: ['guardrails', 'history_summary'],
  },
  {
    id: 'insights',
    label: 'Insights Agent',
    description: 'PKI + closure patterns + knowledge retrieval',
    capabilities: ['pki', 'knowledge_search', 'coach_summary'],
  },
  {
    id: 'orchestrator',
    label: 'Orchestrator',
    description: 'Coordina pipeline multi-agente',
    capabilities: ['pipeline', 'dispatch'],
  },
]

export function getAgentDescriptor(id: AgentId): AgentDescriptor | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id)
}

export function listAgentIds(): AgentId[] {
  return AGENT_REGISTRY.map((a) => a.id)
}

/** Pipeline predefinite MIRAX. */
export const PRESET_PIPELINES: Record<string, AgentId[]> = {
  coach: ['insights'],
  search_nlp: ['search'],
  outreach_safe: ['outreach'],
  audit_batch: ['audit'],
}
