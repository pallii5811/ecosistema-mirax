import { parseSignalIntentHeuristic } from './parse-heuristic'
import type { SignalIntentSpec } from './types'
import { EMPTY_SIGNAL_INTENT } from './types'
import { inferFromSemanticGraph, normalizeClaudeSignalIntent } from './semantic-graph-fallback'

const CACHE_TTL_MS = 60 * 60 * 1000
const semanticCache = new Map<string, { result: SignalIntentSpec; ts: number }>()

const CLAUDE_PROMPT = `Sei MIRAX Semantic Engine, un esperto di intelligence commerciale B2B italiano.
Analizza la query di ricerca lead in italiano naturale e restituisci SOLO JSON valido.

REGOLA: interpreta il CONTESTO, non le parole singole.

QUERY: "{{QUERY}}"

Segnali ammessi in required_signals:
hiring, registry_change, sector_investment, tender_won, crm_detected, crm_change, site_stale, meta_ads_started, google_ads_started, investing_marketing

Output JSON:
{
  "category": "string o null",
  "location": "string o null",
  "required_signals": [],
  "hiring_roles": [],
  "sector_keywords": [],
  "crm_keywords": [],
  "technical_filters": {
    "has_gtm": true/false/null,
    "has_meta_pixel": true/false/null,
    "has_google_analytics": true/false/null,
    "has_ssl": true/false/null,
    "errors_seo": true/false/null,
    "site_speed": "fast"/"slow"/null,
    "mobile_friendly": true/false/null
  },
  "social_filters": {
    "has_instagram": true/false/null,
    "has_facebook": true/false/null,
    "has_linkedin": true/false/null,
    "reviews_negative": true/false/null
  },
  "business_filters": {
    "revenue_min": number|null,
    "revenue_max": number|null,
    "employees_min": number|null,
    "employees_max": number|null,
    "founded_after": "YYYY-MM-DD"|null,
    "founded_before": "YYYY-MM-DD"|null
  },
  "reasoning": "breve spiegazione in italiano"
}`

function hasTechnicalFilters(spec: SignalIntentSpec): boolean {
  const tf = spec.technical_filters
  if (!tf) return false
  return Object.values(tf).some((v) => v !== null && v !== undefined)
}

function hasSocialFilters(spec: SignalIntentSpec): boolean {
  const sf = spec.social_filters
  if (!sf) return false
  return Object.values(sf).some((v) => v !== null && v !== undefined)
}

function hasBusinessFilters(spec: SignalIntentSpec): boolean {
  const bf = spec.business_filters
  if (!bf) return false
  return Object.values(bf).some((v) => v !== null && v !== undefined)
}

export function intentSpecHasMatches(spec: SignalIntentSpec): boolean {
  return (
    spec.required_signals.length > 0 ||
    hasTechnicalFilters(spec) ||
    hasSocialFilters(spec) ||
    hasBusinessFilters(spec)
  )
}

async function callAnthropicSemantic(query: string): Promise<SignalIntentSpec | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const model = process.env.SEMANTIC_MODEL || 'claude-sonnet-4-20250514'
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0,
      messages: [{ role: 'user', content: CLAUDE_PROMPT.replace('{{QUERY}}', query) }],
    }),
    signal: AbortSignal.timeout(25_000),
  })

  if (!res.ok) {
    console.warn('[semantic] Claude HTTP', res.status)
    return null
  }

  const data = (await res.json()) as { content?: Array<{ text?: string }> }
  const text = data.content?.[0]?.text || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return normalizeClaudeSignalIntent(JSON.parse(match[0]) as Record<string, unknown>)
  } catch {
    return null
  }
}

async function callOpenAiSemantic(query: string): Promise<SignalIntentSpec | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.SEMANTIC_OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Rispondi solo con JSON valido.' },
        { role: 'user', content: CLAUDE_PROMPT.replace('{{QUERY}}', query) },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  })

  if (!res.ok) {
    console.warn('[semantic] OpenAI HTTP', res.status)
    return null
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content || ''
  try {
    return normalizeClaudeSignalIntent(JSON.parse(text) as Record<string, unknown>)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return normalizeClaudeSignalIntent(JSON.parse(match[0]) as Record<string, unknown>)
    } catch {
      return null
    }
  }
}

async function callSemanticAi(query: string): Promise<SignalIntentSpec> {
  const fromClaude = await callAnthropicSemantic(query)
  if (fromClaude && intentSpecHasMatches(fromClaude)) return fromClaude
  const fromOpenAi = await callOpenAiSemantic(query)
  if (fromOpenAi && intentSpecHasMatches(fromOpenAi)) return fromOpenAi
  return inferFromSemanticGraph(query)
}

function mergeIntentSummary(spec: SignalIntentSpec): SignalIntentSpec {
  if (spec.reasoning) {
    spec.intent_summary = spec.reasoning
  } else if (!spec.intent_summary) {
    const parts: string[] = []
    if (spec.required_signals.length) parts.push(`Segnali: ${spec.required_signals.join(', ')}`)
    if (spec.category) parts.push(`Categoria: ${spec.category}`)
    if (spec.location) parts.push(`Zona: ${spec.location}`)
    spec.intent_summary = parts.length ? parts.join(' · ') : null
  }
  return spec
}

/** Parser ibrido: euristico (1ms) → Claude/OpenAI → semantic graph fallback. */
export async function parseSignalIntent(query: string): Promise<SignalIntentSpec> {
  const q = (query || '').trim()
  if (!q) return { ...EMPTY_SIGNAL_INTENT }

  const heuristic = parseSignalIntentHeuristic(q)
  heuristic.parse_source = 'heuristic'
  if (intentSpecHasMatches(heuristic)) {
    return mergeIntentSummary(heuristic)
  }

  const words = q.split(/\s+/).filter((w) => w.length > 2)
  if (words.length <= 3) {
    return mergeIntentSummary(heuristic)
  }

  const cacheKey = q.toLowerCase()
  const cached = semanticCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result
  }

  let semantic: SignalIntentSpec
  try {
    semantic = await callSemanticAi(q)
  } catch (e) {
    console.warn('[semantic] AI call failed', e)
    semantic = inferFromSemanticGraph(q)
  }

  const merged: SignalIntentSpec = {
    ...heuristic,
    required_signals: [...new Set([...heuristic.required_signals, ...semantic.required_signals])],
    hiring_roles: [...new Set([...heuristic.hiring_roles, ...semantic.hiring_roles])],
    sector_keywords: [...new Set([...heuristic.sector_keywords, ...semantic.sector_keywords])],
    crm_keywords: [...new Set([...heuristic.crm_keywords, ...semantic.crm_keywords])],
    require_crm_change: heuristic.require_crm_change || semantic.require_crm_change,
    time_window_days: heuristic.time_window_days ?? semantic.time_window_days,
    category: semantic.category ?? heuristic.category ?? null,
    location: semantic.location ?? heuristic.location ?? null,
    technical_filters: { ...heuristic.technical_filters, ...semantic.technical_filters },
    social_filters: { ...heuristic.social_filters, ...semantic.social_filters },
    business_filters: { ...heuristic.business_filters, ...semantic.business_filters },
    reasoning: semantic.reasoning ?? heuristic.reasoning ?? null,
    parse_source: semantic.parse_source === 'semantic_ai' ? 'semantic_ai' : 'semantic_graph',
    intent_summary: null,
  }

  const result = mergeIntentSummary(merged)
  semanticCache.set(cacheKey, { result, ts: Date.now() })
  return result
}

/** Per test offline — salta chiamate AI */
export function parseSignalIntentOffline(query: string): SignalIntentSpec {
  const heuristic = parseSignalIntentHeuristic(query)
  // Se l'euristica ha già estratto categoria o location, usala senza aggiungere segnali "a caso" dal graph fallback.
  if (intentSpecHasMatches(heuristic) || heuristic.category || heuristic.location) {
    return mergeIntentSummary({ ...heuristic, parse_source: 'heuristic' })
  }
  return mergeIntentSummary(inferFromSemanticGraph(query))
}

export { hasTechnicalFilters, hasSocialFilters, hasBusinessFilters }
