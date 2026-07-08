/**
 * UQE Step 4.2 — Esecutore piano (graph Neo4j + discovery Maps/worker).
 * Server-only: orchestra motori e normalizza lead per ResultsTable.
 */
import 'server-only'

import { unifiedSearchAction, type UnifiedSearchResponse } from '@/app/dashboard/unified-search-action'
import { normalizeLeadObject } from '@/lib/lead-object'
import { normalizeLead } from '@/lib/nous/normalizer'
import { requestAgenticWorkerJob } from '@/lib/search-cache'
import { AGENTIC_NICHE_USER_MESSAGE, clampSearchMaxLeads } from '@/lib/search-job-payload'
import { isNeo4jConfigured, Neo4jConfigError, runNeo4jQuery } from '@/lib/universe/neo4j-client'
import type { MiraxQueryPlan } from '@/types/uqe'

const GRAPH_QUERY_TIMEOUT_MS = 20_000
const HYBRID_GRAPH_MIN = 5
const DEFAULT_MAX_LEADS = 25
const MAX_UQE_LEADS = 500

export class UqeExecuteError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(message: string, code = 'UQE_EXECUTE_ERROR', cause?: unknown) {
    super(message)
    this.name = 'UqeExecuteError'
    this.code = code
    this.cause = cause
  }
}

export type UqeExecuteResult = {
  results: Record<string, unknown>[]
  status: 'completed' | 'pending' | 'fallback'
  jobId?: string
  searchId?: string
  user_message?: string | null
  filters?: Record<string, unknown>
  ai_debug?: Record<string, unknown>
  engines_used: string[]
}

export type CypherQueryBundle = {
  cypher: string
  params: Record<string, unknown>
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new UqeExecuteError(`${label} timeout dopo ${ms}ms`, 'UQE_TIMEOUT'))
    }, ms)
    promise
      .then((v) => {
        clearTimeout(timer)
        resolve(v)
      })
      .catch((e) => {
        clearTimeout(timer)
        reject(e)
      })
  })
}

/** Costruisce Cypher parametrizzato dal MiraxQueryPlan. */
export function buildCypherFromPlan(plan: MiraxQueryPlan, limit = DEFAULT_MAX_LEADS): CypherQueryBundle {
  const where: string[] = []
  const params: Record<string, unknown> = {
    sector: plan.sector || '',
    location: plan.location || '',
    limit,
  }

  where.push(`(
    $sector = '' OR
    toLower(coalesce(c.category, c.categoria, '')) CONTAINS toLower($sector) OR
    toLower(coalesce(c.name, '')) CONTAINS toLower($sector)
  )`)

  where.push(`(
    $location = '' OR
    toLower(coalesce(c.city, c.citta, '')) CONTAINS toLower($location)
  )`)

  const tf = plan.technical_filters || {}

  if (tf.has_meta_pixel === false) {
    where.push(`NOT EXISTS {
      MATCH (c)-[:USES_TECH]->(t:Technology)
      WHERE t.slug = 'meta_pixel' OR toLower(coalesce(t.name, '')) CONTAINS 'meta pixel'
    }`)
  } else if (tf.has_meta_pixel === true) {
    where.push(`EXISTS {
      MATCH (c)-[:USES_TECH]->(t:Technology)
      WHERE t.slug = 'meta_pixel' OR toLower(coalesce(t.name, '')) CONTAINS 'meta pixel'
    }`)
  }

  if (tf.has_gtm === false) {
    where.push(`NOT EXISTS {
      MATCH (c)-[:USES_TECH]->(t:Technology)
      WHERE t.slug = 'google_tag_manager' OR toLower(coalesce(t.name, '')) CONTAINS 'tag manager'
    }`)
  } else if (tf.has_gtm === true) {
    where.push(`EXISTS {
      MATCH (c)-[:USES_TECH]->(t:Technology)
      WHERE t.slug = 'google_tag_manager' OR toLower(coalesce(t.name, '')) CONTAINS 'tag manager'
    }`)
  }

  const techList = Array.isArray(tf.technologies) ? tf.technologies : []
  for (let i = 0; i < techList.length; i++) {
    const slug = String(techList[i] || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
    if (!slug) continue
    const key = `tech_slug_${i}`
    params[key] = slug
    where.push(`EXISTS {
      MATCH (c)-[:USES_TECH]->(t:Technology)
      WHERE t.slug = $${key} OR toLower(coalesce(t.name, '')) CONTAINS replace($${key}, '_', ' ')
    }`)
  }

  for (let i = 0; i < plan.required_signals.length; i++) {
    const sig = plan.required_signals[i]
    const key = `signal_${i}`
    params[key] = sig
    if (sig === 'no_pixel') {
      where.push(`NOT EXISTS {
        MATCH (c)-[:USES_TECH]->(t:Technology)
        WHERE t.slug = 'meta_pixel' OR toLower(coalesce(t.name, '')) CONTAINS 'meta pixel'
      }`)
      continue
    }
    where.push(`EXISTS {
      MATCH (c)-[:HAS_SIGNAL]->(s:Signal)
      WHERE s.kind = $${key} OR s.slug CONTAINS $${key} OR toLower(coalesce(s.name, '')) CONTAINS replace($${key}, '_', ' ')
    }`)
  }

  const whereClause = where.length ? `WHERE ${where.join('\n  AND ')}` : ''

  const cypher = `
MATCH (c:Company)
${whereClause}
OPTIONAL MATCH (c)-[:USES_TECH]->(t:Technology)
OPTIONAL MATCH (c)-[:HAS_SIGNAL]->(s:Signal)
WITH c, collect(DISTINCT t) AS technologies, collect(DISTINCT s) AS signals
RETURN c AS company, technologies, signals
ORDER BY coalesce(c.updated_at, c.created_at) DESC
LIMIT $limit
`.trim()

  return { cypher, params }
}

function nodeProperties(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object') return {}
  const n = node as Record<string, unknown>
  if (n._type === 'node' && n.properties && typeof n.properties === 'object') {
    return n.properties as Record<string, unknown>
  }
  return n
}

function techNodesToStack(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return []
  const out: string[] = []
  for (const node of nodes) {
    const props = nodeProperties(node)
    const name = String(props.name || props.slug || '').trim()
    if (name) out.push(name)
  }
  return out
}

function signalNodesToBusinessSignals(nodes: unknown): Record<string, unknown>[] {
  if (!Array.isArray(nodes)) return []
  const out: Record<string, unknown>[] = []
  for (const node of nodes) {
    const props = nodeProperties(node)
    const kind = String(props.kind || props.slug || 'signal').trim()
    const label = String(props.name || kind).trim()
    if (!label) continue
    out.push({
      type: kind,
      label,
      confidence: props.confidence ?? 0.75,
      source: 'neo4j_graph',
    })
  }
  return out
}

function websiteFromProps(props: Record<string, unknown>): string {
  const site = String(props.website || props.sito || '').trim()
  if (site) return site
  const domain = String(props.website_domain || '').trim()
  if (domain) return domain.startsWith('http') ? domain : `https://${domain}`
  return ''
}

/** Mappa record Neo4j (Company + relazioni) → lead piatto UI. */
export function mapGraphRecordsToLeads(
  records: Record<string, unknown>[],
  plan?: MiraxQueryPlan,
): Record<string, unknown>[] {
  const leads: Record<string, unknown>[] = []

  for (const row of records) {
    const props = nodeProperties(row.company)
    if (!props || Object.keys(props).length === 0) continue

    const technologies = techNodesToStack(row.technologies)
    const business_signals = signalNodesToBusinessSignals(row.signals)
    const hasMetaPixel = technologies.some((t) => /meta\s*pixel/i.test(t)) || props.has_pixel === true

    const raw: Record<string, unknown> = {
      azienda: props.name || props.azienda,
      nome: props.name || props.azienda,
      sito: websiteFromProps(props),
      website: websiteFromProps(props),
      email: props.email,
      telefono: props.phone || props.telefono,
      citta: props.city || props.citta,
      categoria: props.category || props.categoria || plan?.sector || '',
      website_domain: props.website_domain,
      partita_iva: props.partita_iva,
      tech_stack: technologies.length ? technologies : undefined,
      meta_pixel: hasMetaPixel,
      business_signals: business_signals.length ? business_signals : undefined,
      business_hiring_jobs:
        business_signals.some((s) => s.type === 'hiring') || plan?.required_signals.includes('hiring')
          ? [{ title: 'Hiring (grafo)', source: 'neo4j_graph' }]
          : undefined,
      _source: 'neo4j_graph',
      _uqe_plan: plan
        ? {
            search_strategy: plan.search_strategy,
            sector: plan.sector,
            location: plan.location,
          }
        : undefined,
    }

    const nous = normalizeLead(raw)
    const merged: Record<string, unknown> = {
      ...raw,
      azienda: nous.nome || raw.azienda,
      nome: nous.nome,
      sito: nous.sito,
      email: nous.email,
      telefono: nous.telefono,
      citta: nous.citta,
      categoria: nous.categoria || raw.categoria,
      opportunity_score: nous.score,
    }

    leads.push(normalizeLeadObject(merged) as Record<string, unknown>)
  }

  return leads
}

/**
 * Esegue query sul grafo via stesso percorso del BFF (runNeo4jQuery server-side).
 * Il frontend continua a usare POST /api/universe/graph-bff.
 */
async function executeGraphQuery(plan: MiraxQueryPlan, limit: number): Promise<Record<string, unknown>[]> {
  if (!isNeo4jConfigured()) {
    throw new UqeExecuteError(
      'Neo4j non configurato. Imposta NEO4J_URI e credenziali oppure usa search_strategy maps/hybrid.',
      'NEO4J_NOT_CONFIGURED',
    )
  }

  const { cypher, params } = buildCypherFromPlan(plan, limit)

  try {
    const result = await withTimeout(
      runNeo4jQuery({ cypher, params, mode: 'READ' }),
      GRAPH_QUERY_TIMEOUT_MS,
      'Neo4j',
    )
    return mapGraphRecordsToLeads(result.records, plan)
  } catch (e) {
    if (e instanceof UqeExecuteError) throw e
    if (e instanceof Neo4jConfigError) {
      throw new UqeExecuteError(e.message, 'NEO4J_NOT_CONFIGURED', e)
    }
    const message = e instanceof Error ? e.message : 'Errore query Neo4j'
    throw new UqeExecuteError(message, 'NEO4J_QUERY_FAILED', e)
  }
}

async function executeOrganicWebSearch(
  plan: MiraxQueryPlan,
  maxLeads: number,
  userId: string,
  opts?: { userMessage?: string | null },
): Promise<UqeExecuteResult> {
  const { createClient } = await import('@/utils/supabase/server')
  const supabase = await createClient()

  const agenticMax = clampSearchMaxLeads(maxLeads)

  const job = await requestAgenticWorkerJob(supabase, {
    query: plan.original_query,
    maxLeads: agenticMax,
    userId,
    location: plan.location || 'Italia',
    sector: plan.sector || 'Agentic AI',
    plan: {
      original_query: plan.original_query,
      search_strategy: plan.search_strategy,
      sector: plan.sector,
      location: plan.location,
      required_signals: plan.required_signals,
      technical_filters: plan.technical_filters,
      extraction_schema: plan.extraction_schema,
      intent_summary: plan.intent_summary,
      research_questions: plan.research_questions,
      source_plan: plan.source_plan,
      evidence_policy: plan.evidence_policy,
      commercial_hypothesis: plan.commercial_hypothesis,
      ranking_policy: plan.ranking_policy,
    },
    intent: {
      required_signals: plan.required_signals,
      intent_summary: plan.intent_summary,
      commercial_hypothesis: plan.commercial_hypothesis,
      ranking_policy: plan.ranking_policy,
    },
  })

  const user_message = opts?.userMessage ?? AGENTIC_NICHE_USER_MESSAGE

  return {
    results: [],
    status: 'pending',
    jobId: job.jobId,
    searchId: job.searchId,
    filters: { categoria: plan.sector || null, citta: plan.location || null },
    user_message,
    ai_debug: {
      source: 'agentic_worker',
      search_strategy: 'organic_web_search',
      max_leads: agenticMax,
      job_id: job.jobId,
    },
    engines_used: ['agentic_worker'],
  }
}

async function executeMapsDiscovery(
  plan: MiraxQueryPlan,
  maxLeads: number,
): Promise<UnifiedSearchResponse> {
  const query = plan.original_query.trim()
  try {
    const response = await unifiedSearchAction(query, { maxLeads, plan })
    if (response.ai_debug && typeof response.ai_debug === 'object' && 'error' in response.ai_debug) {
      const errMsg = String((response.ai_debug as Record<string, unknown>).error || '')
      if (errMsg && response.results.length === 0 && response.status !== 'pending') {
        throw new UqeExecuteError(errMsg, 'MAPS_SEARCH_FAILED')
      }
    }
    return response
  } catch (e) {
    if (e instanceof UqeExecuteError) throw e
    const message = e instanceof Error ? e.message : 'Discovery worker non disponibile'
    throw new UqeExecuteError(message, 'MAPS_SEARCH_FAILED', e)
  }
}

function leadDedupeKey(lead: Record<string, unknown>): string {
  const domain = String(lead.website_domain || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
  if (domain) return `web:${domain}`
  const phone = String(lead.telefono || lead.phone || '').replace(/\D/g, '')
  if (phone.length >= 8) return `tel:${phone.slice(-9)}`
  const name = String(lead.azienda || lead.nome || '')
    .toLowerCase()
    .trim()
    .slice(0, 40)
  const city = String(lead.citta || lead.city || '')
    .toLowerCase()
    .trim()
  return name ? `name:${name}:${city}` : `uid:${Math.random()}`
}

function mergeLeadLists(
  primary: Record<string, unknown>[],
  secondary: Record<string, unknown>[],
  maxLeads: number,
): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []

  for (const lead of [...primary, ...secondary]) {
    const key = leadDedupeKey(lead)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalizeLeadObject(lead) as Record<string, unknown>)
    if (out.length >= maxLeads) break
  }

  return out
}

/**
 * Orchestratore UQE — routing graph / maps / hybrid / fallback.
 */
export async function executeMiraxQueryPlan(
  plan: MiraxQueryPlan,
  userId: string,
  options?: { maxLeads?: number },
): Promise<UqeExecuteResult> {
  const maxLeads = Math.max(1, Math.min(options?.maxLeads ?? DEFAULT_MAX_LEADS, MAX_UQE_LEADS))
  const engines_used: string[] = []
  const ai_debug: Record<string, unknown> = {
    uqe: true,
    user_id: userId,
    parse_source: plan.parse_source,
    confidence: plan.confidence,
    search_strategy: plan.search_strategy,
    intent_summary: plan.intent_summary,
    reasoning: plan.reasoning,
    required_signals: plan.required_signals,
    technical_filters: plan.technical_filters,
    extraction_schema: plan.extraction_schema,
  }

  const filters: Record<string, unknown> = {
    categoria: plan.sector || null,
    citta: plan.location || null,
  }

  if (plan.search_strategy === 'fallback') {
    return {
      results: [],
      status: 'fallback',
      user_message: plan.user_message || plan.intent_summary,
      filters,
      ai_debug,
      engines_used,
    }
  }

  if (plan.search_strategy === 'organic_web_search') {
    engines_used.push('agentic_worker')
    return executeOrganicWebSearch(plan, maxLeads, userId)
  }

  if (plan.search_strategy === 'graph') {
    engines_used.push('neo4j_graph')
    const results = await executeGraphQuery(plan, maxLeads)
    return {
      results,
      status: 'completed',
      searchId: `uqe-graph-${Date.now()}`,
      filters,
      ai_debug: { ...ai_debug, graph_count: results.length },
      engines_used,
    }
  }

  if (plan.search_strategy === 'maps') {
    engines_used.push('maps_worker')
    const maps = await executeMapsDiscovery(plan, maxLeads)
    const results = (maps.results || []).map((r) => normalizeLeadObject(r) as Record<string, unknown>)
    return {
      results,
      status: maps.status === 'pending' ? 'pending' : 'completed',
      jobId: maps.jobId,
      searchId: maps.searchId,
      filters: maps.filters ?? filters,
      ai_debug: { ...ai_debug, ...(maps.ai_debug ?? {}), maps_count: results.length },
      engines_used,
    }
  }

  // hybrid
  engines_used.push('neo4j_graph')
  let graphResults: Record<string, unknown>[] = []
  let graphError: string | null = null
  try {
    graphResults = await executeGraphQuery(plan, maxLeads)
  } catch (e) {
    graphError = e instanceof Error ? e.message : String(e)
    ai_debug.graph_error = graphError
  }

  const needMaps = graphResults.length < Math.min(maxLeads, HYBRID_GRAPH_MIN)
  if (!needMaps) {
    return {
      results: graphResults.slice(0, maxLeads),
      status: 'completed',
      searchId: `uqe-hybrid-graph-${Date.now()}`,
      filters,
      ai_debug: { ...ai_debug, graph_count: graphResults.length, maps_skipped: true },
      engines_used,
    }
  }

  engines_used.push('maps_worker')
  const maps = await executeMapsDiscovery(plan, maxLeads)
  const mapsResults = (maps.results || []).map((r) => normalizeLeadObject(r) as Record<string, unknown>)
  const merged = mergeLeadLists(graphResults, mapsResults, maxLeads)

  if (maps.status === 'pending') {
    return {
      results: merged,
      status: 'pending',
      jobId: maps.jobId,
      searchId: maps.searchId ?? maps.jobId,
      filters: maps.filters ?? filters,
      ai_debug: {
        ...ai_debug,
        ...(maps.ai_debug ?? {}),
        graph_count: graphResults.length,
        maps_count: mapsResults.length,
        merged_count: merged.length,
        graph_error: graphError,
      },
      engines_used,
    }
  }

  return {
    results: merged,
    status: 'completed',
    searchId: maps.searchId ?? `uqe-hybrid-${Date.now()}`,
    jobId: maps.jobId,
    filters: maps.filters ?? filters,
    ai_debug: {
      ...ai_debug,
      ...(maps.ai_debug ?? {}),
      graph_count: graphResults.length,
      maps_count: mapsResults.length,
      merged_count: merged.length,
      graph_error: graphError,
    },
    engines_used,
  }
}
