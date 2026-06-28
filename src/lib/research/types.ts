import type { MiraxSignal } from '@/lib/mirax-signals'

export type ResearchLeadInput = {
  name: string
  website?: string
  city?: string
  sector?: string
  piva?: string
}

export type ResearchToolName = 'search_web' | 'read_page' | 'check_api' | 'verify_fact'

export type SearchWebParams = { query: string; max_results?: number }
export type ReadPageParams = { url: string; extract_selector?: string }
export type CheckApiParams = { endpoint: string; params?: Record<string, string> }
export type VerifyFactParams = { claim: string; sources: string[] }

export type ResearchToolCall =
  | { name: 'search_web'; params: SearchWebParams }
  | { name: 'read_page'; params: ReadPageParams }
  | { name: 'check_api'; params: CheckApiParams }
  | { name: 'verify_fact'; params: VerifyFactParams }

export type ResearchToolResult = {
  tool: ResearchToolName
  ok: boolean
  data: unknown
  error?: string
}

export type ResearchAgentOutput = {
  signals: MiraxSignal[]
  research_summary: string
  model: string
  from_cache: boolean
  tools_used: ResearchToolName[]
  estimated_cost_usd: number
}

export type ResearchCacheRow = {
  cache_key: string
  lead_website: string
  payload: ResearchAgentOutput
  created_at: string
  expires_at: string
}
