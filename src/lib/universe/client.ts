import type {
  EntityType,
  RelatedEntity,
  TimelinePoint,
  UniverseEntity,
  UniverseEvent,
} from './types.ts'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import type { CommercialIntent } from '@/lib/signal-intent/commercial-intent'
import type { UniverseQuery } from './query-builder.ts'
import type { FeedbackAction } from './feedback.ts'

export type AgenticSearchResult = {
  ok: boolean
  mode?: 'commercial' | 'signal'
  user_query: string | null
  intent_summary: string
  reasoning?: string | null
  confidence?: number | null
  parse_source: string
  commercial_intent?: CommercialIntent | null
  signal_intent?: SignalIntentSpec
  universe_query: UniverseQuery
  total: number
  results: Record<string, unknown>[]
  elapsed_ms?: number
}

export async function runAgenticUniverseSearch(
  opts: {
    user_query: string
    city?: string
    limit?: number
  },
  signal?: AbortSignal,
): Promise<AgenticSearchResult> {
  const res = await fetch('/api/universe/agentic-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    cache: 'no-store',
    signal,
  })
  return parseJson<AgenticSearchResult>(res)
}

export type UniverseSearchParams = {
  entity_type?: EntityType
  city?: string
  country?: string
  name_contains?: string
  limit?: number
  offset?: number
  with_latest_observations?: boolean | string[]
}

export type UniverseEntitySummary = UniverseEntity & {
  latest_observations?: Record<string, unknown>
}

export type UniverseEntityDetail = {
  entity: UniverseEntity
  timeline: TimelinePoint[]
  related: RelatedEntity[]
  events?: UniverseEvent[]
}

export type DigitalTwinResponse = {
  ok: boolean
  twin: import('./digital-twin.ts').DigitalTwinSnapshot
}

export type UniverseResolveResult = {
  entity: UniverseEntity
  timeline: TimelinePoint[]
  related: RelatedEntity[]
}

async function parseJson<T>(res: Response): Promise<T & { error?: string }> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function searchUniverseEntities(params: UniverseSearchParams = {}) {
  const res = await fetch('/api/universe/entities/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    cache: 'no-store',
  })
  const data = await parseJson<{ entities: UniverseEntitySummary[]; count: number }>(res)
  return data
}

export async function getUniverseEntity(id: string) {
  const res = await fetch(`/api/universe/entities/${encodeURIComponent(id)}`, { cache: 'no-store' })
  return parseJson<UniverseEntityDetail>(res)
}

export async function getUniverseDigitalTwin(entityId: string) {
  const res = await fetch(`/api/universe/entities/${encodeURIComponent(entityId)}/twin`, {
    cache: 'no-store',
  })
  return parseJson<DigitalTwinResponse>(res)
}

export async function getUniverseUserContext(entityId: string) {
  const res = await fetch(`/api/universe/entities/${encodeURIComponent(entityId)}/context`, {
    cache: 'no-store',
  })
  return parseJson<{ ok: boolean; contexts: Array<{ context_type: string; metadata?: Record<string, unknown> }> }>(res)
}

export async function setUniverseUserContext(
  entityId: string,
  context_type: 'saved' | 'contacted' | 'pipeline' | 'ignored' | 'note' | 'hidden',
  metadata?: Record<string, unknown>,
) {
  const res = await fetch(`/api/universe/entities/${encodeURIComponent(entityId)}/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_type, metadata }),
  })
  return parseJson<{ ok: boolean; context: unknown }>(res)
}

export async function removeUniverseUserContext(
  entityId: string,
  context_type: string,
) {
  const qs = new URLSearchParams({ context_type })
  const res = await fetch(
    `/api/universe/entities/${encodeURIComponent(entityId)}/context?${qs}`,
    { method: 'DELETE' },
  )
  return parseJson<{ ok: boolean }>(res)
}

export async function recordUniverseFeedback(opts: {
  entity_id?: string | null
  action: FeedbackAction
  user_query?: string | null
  search_intent?: Record<string, unknown>
  outcome?: string | null
  feedback_value?: number | null
  metadata?: Record<string, unknown>
}) {
  const res = await fetch('/api/universe/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  return parseJson<{ ok: boolean; feedback: unknown }>(res)
}

export async function runUniverseAgentPipeline(opts: {
  pipeline: string[]
  input?: Record<string, unknown>
}) {
  const res = await fetch('/api/agents/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    cache: 'no-store',
  })
  return parseJson<{ pipeline: string[]; results: unknown[] }>(res)
}

export async function resolveUniverseEntityByDomain(domain: string) {
  const qs = new URLSearchParams({ domain })
  const res = await fetch(`/api/universe/entities/resolve?${qs}`, { cache: 'no-store' })
  if (res.status === 404) return null
  return parseJson<UniverseResolveResult>(res)
}

export async function getUniverseTimeline(entityId: string, attribute?: string) {
  const qs = new URLSearchParams()
  if (attribute) qs.set('attribute', attribute)
  const res = await fetch(`/api/universe/timeline/${encodeURIComponent(entityId)}?${qs}`, { cache: 'no-store' })
  return parseJson<{ points: TimelinePoint[]; count: number }>(res)
}

export async function getEntityPii(entityId: string) {
  const res = await fetch(`/api/universe/entities/${encodeURIComponent(entityId)}/pii`, { cache: 'no-store' })
  return parseJson<{ ok: boolean; pii: { phone: string | null; email: string | null; pec_email: string | null; mobile_phone: string | null }; remaining: number; count: number }>(res)
}
