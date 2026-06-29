/**
 * Blocco 8 — tipi agenti MIRAX (multi-agent pragmatico).
 */

export type AgentId =
  | 'search'
  | 'audit'
  | 'pitch'
  | 'outreach'
  | 'insights'
  | 'universe'
  | 'orchestrator'

export type AgentStatus = 'success' | 'error' | 'skipped'

export type AgentRunResult<T = unknown> = {
  agent: AgentId
  status: AgentStatus
  data?: T
  error?: string
  meta?: Record<string, unknown>
}

export type OrchestratorPipeline = AgentId[]

export type AgentDescriptor = {
  id: AgentId
  label: string
  description: string
  capabilities: string[]
}
