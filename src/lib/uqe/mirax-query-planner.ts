/**
 * UQE Step 4.1 — AI Planner con Tool Calling (OpenAI / Anthropic).
 * Traduce linguaggio naturale → MiraxQueryPlan tipizzato.
 */
import {
  createFallbackPlan,
  DEFAULT_EXTRACTION_SCHEMA,
  UQE_SIGNAL_ALIASES,
  UqePlannerError,
  type MiraxQueryPlan,
  type UqeParseSource,
  type UqeSearchStrategy,
} from '@/types/uqe'
import { parseSignalIntentHeuristic } from '@/lib/signal-intent/parse-heuristic'
import {
  isBuyerMarketingInvestmentQuery,
  isSellerMarketingAgencySector,
} from '@/lib/signal-intent/marketing-investment'

const MIRAX_QUERY_PLAN_TOOL_NAME = 'submit_mirax_query_plan'

const SYSTEM_PROMPT = `Sei il motore semantico di MIRAX. Analizza la query dell'utente e decidi la strategia.

REGOLE DI ROUTING (CRITICHE):
1. maps — categoria fisica + città (es. 'imprese edili a Genova', 'ristoranti Milano', 'imprese di pulizie a Otranto') O filtri tecnici sul sito (es. 'senza pixel', 'con errori SEO').
2. hybrid — query con SEGNALI su aziende target (es. 'aziende che investono in marketing', 'che assumono', 'in espansione', 'hanno vinto gare') SENZA che l'utente venda un servizio. Usa hybrid: Maps + arricchimento segnali.
3. organic_web_search — SOLO intento venditore/servizio astratto (es. 'sono commercialista cerco clienti', 'trovami lead per vendere servizi da consulente', 'potenziali clienti per il mio studio').
NON usare organic_web_search per 'aziende che investono in marketing' o simili: è hybrid/maps, non ricerca web agentic pura.

Devi SEMPRE chiamare submit_mirax_query_plan con: search_strategy, sector, location, required_signals, technical_filters, extraction_schema, confidence, intent_summary, is_unmappable.
- sector: settore/categoria target dedotto dalla query.
- location: città/regione se esplicita, altrimenti "" o "Italia".
- required_signals: es. hiring, new_company, funding_received, expansion, no_pixel.
- technical_filters: has_meta_pixel, has_gtm, technologies, ecc. se richiesti.
- extraction_schema: email, telefono, sito, azienda, …
Se unmappable: is_unmappable=true + user_message in italiano.`

const OPENAI_TOOL_SCHEMA = {
  type: 'function' as const,
  function: {
    name: MIRAX_QUERY_PLAN_TOOL_NAME,
    description: 'Invia il piano di ricerca MIRAX strutturato.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        search_strategy: {
          type: 'string',
          enum: ['graph', 'maps', 'hybrid', 'organic_web_search'],
          description: 'Motore di esecuzione primario.',
        },
        sector: { type: 'string', description: 'Settore/categoria target.' },
        location: { type: 'string', description: 'Località geografica.' },
        required_signals: {
          type: 'array',
          items: { type: 'string' },
          description: "Segnali d'acquisto richiesti.",
        },
        technical_filters: {
          type: 'object',
          additionalProperties: true,
          description: 'Filtri tecnologici (has_meta_pixel, technologies, ...).',
        },
        extraction_schema: {
          type: 'array',
          items: { type: 'string' },
          description: 'Campi da estrarre per ogni lead.',
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        intent_summary: { type: 'string', description: "Sintesi breve in italiano per l'utente." },
        reasoning: { type: 'string', description: 'Spiegazione del ragionamento.' },
        is_unmappable: {
          type: 'boolean',
          description: 'True se la query non può essere eseguita.',
        },
        user_message: {
          type: 'string',
          description: "Messaggio per l'utente se unmappable o chiarimento necessario.",
        },
      },
      required: [
        'search_strategy',
        'sector',
        'location',
        'required_signals',
        'technical_filters',
        'extraction_schema',
        'confidence',
        'intent_summary',
        'is_unmappable',
      ],
    },
  },
}

const ANTHROPIC_TOOL_SCHEMA = {
  name: MIRAX_QUERY_PLAN_TOOL_NAME,
  description: 'Invia il piano di ricerca MIRAX strutturato.',
  input_schema: OPENAI_TOOL_SCHEMA.function.parameters,
}

type RawToolPlan = {
  search_strategy?: string
  sector?: string
  location?: string
  required_signals?: unknown
  technical_filters?: unknown
  extraction_schema?: unknown
  confidence?: unknown
  intent_summary?: string
  reasoning?: string
  is_unmappable?: boolean
  user_message?: string
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeSignals(signals: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of signals) {
    const key = raw.toLowerCase().trim().replace(/\s+/g, '_')
    const mapped = UQE_SIGNAL_ALIASES[key] || UQE_SIGNAL_ALIASES[raw.toLowerCase().trim()] || key
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped)
      out.push(mapped)
    }
  }
  return out
}

function normalizeStrategy(v: unknown): UqeSearchStrategy {
  const s = String(v || '').toLowerCase()
  if (s === 'graph' || s === 'maps' || s === 'hybrid' || s === 'fallback' || s === 'organic_web_search') {
    return s
  }
  return 'hybrid'
}

function technicalFiltersFromHeuristic(
  tf: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!tf || typeof tf !== 'object') return {}
  const out: Record<string, unknown> = { ...tf }
  if (tf.has_meta_pixel === false) out.has_meta_pixel = false
  if (tf.has_gtm === false) out.has_gtm = false
  if (tf.has_google_analytics === false) out.has_google_analytics = false
  if (Array.isArray(tf.technologies) && tf.technologies.length) {
    out.technologies = tf.technologies
  }
  return out
}

function inferEconomicIntentSignals(query: string): string[] {
  const q = query.toLowerCase()
  const out: string[] = []
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s)
  }

  if (/\b(commercialist|ragioniere|contabil|consulent\w*\s+fisc|cfd\b|fiscalist)\b/i.test(q)) {
    add('new_company')
    add('funding_received')
  }
  if (/\b(programmator|sviluppat|developer|python|software|full[\s-]?stack)\b/i.test(q)) {
    add('hiring')
    add('tech_migration')
  }
  const buyerMarketingSpend = /\b(invest\w*\s+in\s+marketing|budget\s+marketing|spendono\s+in\s+pubblicit\w*)\b/i.test(q)
  if (buyerMarketingSpend) {
    add('investing_marketing')
  }
  if (
    !buyerMarketingSpend &&
    /\b(marketing|seo\b|google ads|meta ads|social media|agenzia)\b/i.test(q)
  ) {
    add('hiring')
    add('expansion')
  }
  if (/\b(potenziali clienti|vendere|clienti per|mi servono clienti|cerco clienti|servizi da)\b/i.test(q)) {
    add('new_company')
    add('funding_received')
    add('expansion')
  }
  if (/\b(sono\s+un|sono\s+una|freelanc|libero\s+profession)\b/i.test(q) && out.length === 0) {
    add('new_company')
    add('expansion')
  }
  return out
}

/** Intento venditore astratto → solo agentic organic. */
export function isSellerAbstractQuery(query: string): boolean {
  return /\b(sono\s+(?:un|una)\b|potenziali\s+clienti|cerco\s+clienti|trov\w+\s+lead|lead\s+caldi|vendere\s+i\s+miei|servizi\s+da|clienti\s+per|mi\s+servono\s+clienti)\b/i.test(
    query.trim(),
  )
}

/** Solo fallback offline quando LLM non risponde — non usato per routing produzione. */
function _heuristicLooksAbstract(query: string): boolean {
  return isSellerAbstractQuery(query)
}

const NON_GEO_AFTER_PREP =
  'marketing|software|digitale|crescita|espansione|vendite|cloud|crm|seo|ads|pubblicit\\w*'
const MAPS_CATEGORY_CITY_RE = new RegExp(
  `\\b(imprese|ristoranti|bar|hotel|pizzeri|officine|negozi|agenzie|studi|ditta|ditte|aziende|lavanderie|parrucchieri|commercialisti|edili|pulizie)\\b.*\\b(a|ad|in)\\s+(?!${NON_GEO_AFTER_PREP}\\b)[A-Za-zÀ-ÿ]{3,}`,
  'i',
)

/**
 * Corregge routing LLM: buyer signals → hybrid/maps, mai organic per errore.
 */
export function applyRoutingGuards(plan: MiraxQueryPlan, query: string): MiraxQueryPlan {
  const q = query.trim()
  if (!q) return plan

  let strategy = plan.search_strategy
  const hasTech = plan.technical_filters && Object.keys(plan.technical_filters).length > 0
  const hasSector = Boolean(plan.sector?.trim() && plan.sector.trim().length >= 4)
  const hasLocation = isRealGeoLocation(plan.location || '')
  const hasSignals = plan.required_signals.length > 0

  if (strategy === 'organic_web_search' && !isSellerAbstractQuery(q)) {
    strategy = hasSignals || hasSector ? 'hybrid' : 'maps'
  }

  if (
    (MAPS_CATEGORY_CITY_RE.test(q) || (hasTech && (hasSector || hasLocation))) &&
    !isSellerAbstractQuery(q)
  ) {
    strategy = 'maps'
  }

  if (strategy === 'graph' && (hasSector || hasSignals) && !/\b(grafo|forniscono a|catena|relazione)\b/i.test(q)) {
    strategy = 'hybrid'
  }

  if (strategy === plan.search_strategy) {
    if (
      plan.required_signals.includes('investing_marketing') &&
      isBuyerMarketingInvestmentQuery(q) &&
      (isSellerMarketingAgencySector(plan.sector || '') || !plan.sector.trim())
    ) {
      return {
        ...plan,
        sector: 'aziende in crescita',
        search_strategy: 'hybrid',
        location: plan.location?.trim() || 'Italia',
      }
    }
    return plan
  }
  return {
    ...plan,
    search_strategy: strategy,
    reasoning: `${plan.reasoning || ''} [routing_guard: ${plan.search_strategy}→${strategy}]`.trim(),
  }
}

function _heuristicVagueSector(sector: string): boolean {
  const s = sector.trim().toLowerCase()
  if (!s) return true
  if (/^(aziende?|pmi|servizi?|clienti?|generico|business|italia)$/i.test(s)) return true
  return s.length < 4
}

function isRealGeoLocation(location: string): boolean {
  const s = location.trim().toLowerCase()
  if (!s || s === 'italia') return false
  return !/^(marketing|software|digitale|crescita|espansione|vendite|cloud|crm|seo|ads)$/i.test(s)
}

function inferStrategyFromQuery(query: string, sector: string, location: string, signals: string[]): UqeSearchStrategy {
  if (isSellerAbstractQuery(query)) return 'organic_web_search'
  const q = query.toLowerCase()
  const graphHint =
    /\b(forniscono|fornitore|partner|investito|investe|supply chain|catena|relazione|grafo|clienti di|fornisce a)\b/i.test(q)
  const mapsHint =
    Boolean(sector && location && isRealGeoLocation(location) && !_heuristicVagueSector(sector)) ||
    (isRealGeoLocation(location) && /\b(milano|roma|torino|napoli|bologna)\b/i.test(q))
  if (signals.length > 0 && !isRealGeoLocation(location)) return 'hybrid'
  if (graphHint && mapsHint) return 'hybrid'
  if (graphHint) return 'graph'
  if (mapsHint || (sector && !_heuristicVagueSector(sector) && isRealGeoLocation(location))) return 'maps'
  if (signals.length > 0) return 'hybrid'
  return 'maps'
}

function extractionFromQuery(query: string): string[] {
  const base: string[] = [...DEFAULT_EXTRACTION_SCHEMA]
  const q = query.toLowerCase()
  if (/\bfatturato\b|\brevenue\b|\bturnover\b/i.test(q) && !base.includes('fatturato')) base.push('fatturato')
  if (/\bpartita\s*iva\b|\bpiva\b|\bvat\b/i.test(q) && !base.includes('partita_iva')) base.push('partita_iva')
  if (/\binstagram\b/i.test(q) && !base.includes('instagram')) base.push('instagram')
  if (/\blinkedin\b/i.test(q) && !base.includes('linkedin')) base.push('linkedin')
  return base
}

function planHasExecutableTarget(plan: Pick<MiraxQueryPlan, 'sector' | 'location' | 'required_signals' | 'technical_filters'>): boolean {
  const hasTech = plan.technical_filters && Object.keys(plan.technical_filters).length > 0
  const hasSignals = plan.required_signals.length > 0
  const hasSector = Boolean(plan.sector.trim())
  const hasLocation = Boolean(plan.location.trim())
  return hasSector || hasLocation || hasSignals || hasTech
}

export function normalizeMiraxQueryPlan(
  raw: RawToolPlan,
  originalQuery: string,
  parseSource: UqeParseSource,
): MiraxQueryPlan {
  if (raw.is_unmappable) {
    return createFallbackPlan(
      originalQuery,
      raw.user_message?.trim() ||
        'Non sono riuscito a capire la richiesta. Prova a specificare settore, città o segnale (es. assunzioni, senza Meta Pixel).',
      parseSource,
    )
  }

  const sector = String(raw.sector || '').trim()
  const location = String(raw.location || '').trim()
  const required_signals = normalizeSignals(asStringArray(raw.required_signals))
  const technical_filters =
    raw.technical_filters && typeof raw.technical_filters === 'object' && !Array.isArray(raw.technical_filters)
      ? (raw.technical_filters as Record<string, unknown>)
      : {}

  const extraction_schema = asStringArray(raw.extraction_schema)
  const confidence = clampConfidence(raw.confidence)

  let search_strategy = normalizeStrategy(raw.search_strategy)
  if (search_strategy === 'fallback') search_strategy = 'hybrid'

  const plan: MiraxQueryPlan = {
    original_query: originalQuery,
    search_strategy,
    sector,
    location,
    required_signals,
    technical_filters,
    extraction_schema: extraction_schema.length ? extraction_schema : extractionFromQuery(originalQuery),
    confidence,
    intent_summary: String(raw.intent_summary || '').trim() || `Ricerca: ${originalQuery.slice(0, 120)}`,
    parse_source: parseSource,
    user_message: raw.user_message?.trim() || null,
    reasoning: raw.reasoning?.trim() || null,
  }

  if (!planHasExecutableTarget(plan) || confidence < 0.15) {
    return createFallbackPlan(
      originalQuery,
      plan.user_message ||
        'Specifica almeno un settore, una città o un criterio (es. "ristoranti Milano senza Meta Pixel").',
      parseSource,
    )
  }

  return applyRoutingGuards(plan, originalQuery)
}

export function buildHeuristicMiraxQueryPlan(userInput: string): MiraxQueryPlan {
  const query = userInput.trim()
  const spec = parseSignalIntentHeuristic(query)
  let sector = String(spec.category || spec.sector_keywords?.[0] || '').trim()
  const location = String(spec.location || '').trim()
  const economicSignals = inferEconomicIntentSignals(query)
  const required_signals = normalizeSignals([
    ...(spec.required_signals || []),
    ...economicSignals,
  ])
  const technical_filters = technicalFiltersFromHeuristic(
    (spec.technical_filters || {}) as Record<string, unknown>,
  )

  if (!sector && (_heuristicLooksAbstract(query) || economicSignals.length > 0)) {
    sector = 'aziende in crescita'
  }

  if (
    required_signals.includes('investing_marketing') &&
    isBuyerMarketingInvestmentQuery(query) &&
    (isSellerMarketingAgencySector(sector) || !sector)
  ) {
    sector = 'aziende in crescita'
  }

  const search_strategy = inferStrategyFromQuery(query, sector, location, required_signals)

  const plan: MiraxQueryPlan = {
    original_query: query,
    search_strategy,
    sector,
    location,
    required_signals,
    technical_filters,
    extraction_schema: extractionFromQuery(query),
    confidence: planHasExecutableTarget({ sector, location, required_signals, technical_filters }) ? 0.45 : 0.1,
    intent_summary: spec.intent_summary || `Ricerca euristica: ${query.slice(0, 100)}`,
    parse_source: 'heuristic',
    reasoning: spec.reasoning || 'Parser euristico offline.',
  }

  if (!planHasExecutableTarget(plan) || plan.confidence < 0.15) {
    return createFallbackPlan(
      query,
      'Non ho capito abbastanza la richiesta. Indica settore, città o segnale commerciale.',
      'heuristic',
    )
  }

  return applyRoutingGuards(plan, query)
}

async function callOpenAiQueryPlan(query: string): Promise<RawToolPlan | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.UQE_OPENAI_MODEL || process.env.SEMANTIC_OPENAI_MODEL || 'gpt-4o-mini'

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Query utente:\n${query}` },
      ],
      tools: [OPENAI_TOOL_SCHEMA],
      tool_choice: { type: 'function', function: { name: MIRAX_QUERY_PLAN_TOOL_NAME } },
    }),
    signal: AbortSignal.timeout(28_000),
  })

  if (!res.ok) {
    console.warn('[uqe-planner] OpenAI HTTP', res.status)
    return null
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
      }
    }>
  }

  const toolCall = data.choices?.[0]?.message?.tool_calls?.find(
    (tc) => tc.function?.name === MIRAX_QUERY_PLAN_TOOL_NAME,
  )
  if (!toolCall?.function?.arguments) return null

  try {
    return JSON.parse(toolCall.function.arguments) as RawToolPlan
  } catch {
    return null
  }
}

async function callAnthropicQueryPlan(query: string): Promise<RawToolPlan | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const model = process.env.UQE_ANTHROPIC_MODEL || process.env.SEMANTIC_MODEL || 'claude-sonnet-4-20250514'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature: 0,
      system: SYSTEM_PROMPT,
      tools: [ANTHROPIC_TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: MIRAX_QUERY_PLAN_TOOL_NAME },
      messages: [{ role: 'user', content: `Query utente:\n${query}` }],
    }),
    signal: AbortSignal.timeout(28_000),
  })

  if (!res.ok) {
    console.warn('[uqe-planner] Anthropic HTTP', res.status)
    return null
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; name?: string; input?: RawToolPlan }>
  }

  const block = data.content?.find((c) => c.type === 'tool_use' && c.name === MIRAX_QUERY_PLAN_TOOL_NAME)
  return block?.input ?? null
}

/**
 * Piano unico da linguaggio naturale — Tool Calling LLM + fallback euristico.
 * Non ritorna mai un piano "vuoto silenzioso": fallback esplicito o errore.
 */
export async function buildMiraxQueryPlan(userInput: string): Promise<MiraxQueryPlan> {
  const query = userInput.trim()
  if (!query) {
    throw new UqePlannerError('Query vuota.', 'UQE_EMPTY_QUERY')
  }

  if (query.length > 2000) {
    throw new UqePlannerError('Query troppo lunga (max 2000 caratteri).', 'UQE_QUERY_TOO_LONG')
  }

  let raw: RawToolPlan | null = null
  const parseSource: UqeParseSource = 'llm'

  raw = await callOpenAiQueryPlan(query)
  if (!raw) {
    raw = await callAnthropicQueryPlan(query)
  }

  if (raw) {
    return normalizeMiraxQueryPlan(raw, query, parseSource)
  }

  const heuristic = buildHeuristicMiraxQueryPlan(query)
  if (heuristic.search_strategy === 'fallback') {
    return heuristic
  }

  return heuristic
}
