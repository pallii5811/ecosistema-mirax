import type { CommercialIntent } from './commercial-intent'
import { EMPTY_COMMERCIAL_INTENT } from './commercial-intent'
import { parseSignalIntentHeuristic } from './parse-heuristic'
import { enrichCommercialIntentFromSellerQuery } from '@/lib/signal-intent/seller-buyer-inference'
import type { FeedbackPromptExample } from '@/lib/universe/feedback'

const CACHE_TTL_MS = 60 * 60 * 1000
const commercialCache = new Map<string, { result: CommercialIntent; ts: number }>()
let claudeUnauthorized = false

const COMMERCIAL_INTENT_PROMPT = `Sei MIRAX Commercial Intelligence Engine, un esperto di vendita B2B italiano.
Analizza la query dell'utente e restituisci SOLO JSON valido.

REGOLE:
- Interpreta il contesto commerciale, non le parole singole.
- Identifica COSA vende l'utente e CHI e' il target ideale.
- Estrai segnali di opportunita', vincoli tecnologici, relazioni richieste.
- Le location in Italia possono essere citta', province o regioni.
- NON aggiungere mai una location se l'utente non la specifica esplicitamente. Se la query non nomina una citta'/regione/nazione, lascia target_profile.locations vuoto.
- NON aggiungere settori/industrie se l'utente non li richiede esplicitamente. Query generiche come "aziende che usano WordPress" o "aziende senza Meta Pixel" NON devono avere industries.
- I settori/industrie, quando presenti, vanno normalizzati (es. "automotive", "edilizia", "software", "ristorazione").
- I ruoli sono utili quando il target sono persone (CEO, buyer, purchasing manager, commerciale).
- NON inventare segnali di business (hiring, funding, tender_won, expansion...) se la query non li richiede esplicitamente.
- Per query tecnologiche ("usa WordPress", "con Meta Pixel", "senza Google Analytics"), usa SOLO tech_profile; non aggiungere location, industry o segnali.

{{EXAMPLES}}

QUERY: "{{QUERY}}"

Output JSON:
{
  "user_service_description": "string o null - cosa vende/propone l'utente",
  "target_profile": {
    "entity_types": ["company" | "person" | "public_body"],
    "industries": ["string"],
    "roles": ["string"],
    "locations": ["string"],
    "company_size": { "min_employees": number|null, "max_employees": number|null, "revenue_min": number|null, "revenue_max": number|null }
  },
  "signals": [
    { "type": "hiring|funding|tender_won|site_stale|investing_marketing|seeking_supplier|expansion|executive_change|registry_change|sector_investment", "params": {}, "time_window_days": number|null }
  ],
  "tech_profile": {
    "has": ["gtm", "meta_pixel", "ga4", "shopify", "wordpress", "chatbot", "booking"],
    "missing": ["gtm", "meta_pixel", "ga4", "ssl", "chatbot"]
  },
  "graph_constraints": [
    { "relationship_type": "supplies|buys_from|partner_of|invested_in|customer_of|competes_with|awarded_to", "direction": "incoming|outgoing|any", "target_filter": { "industry": "string", "location": "string", "entity_type": "company|person|public_body" } }
  ],
  "ranking_hint": "hottest|most_ready|largest|recently_active|closest|default",
  "intent_summary": "breve sintesi in italiano da mostrare all'utente",
  "reasoning": "spiegazione del ragionamento in italiano",
  "confidence": 0.0-1.0
}`

function buildPrompt(query: string, examples: FeedbackPromptExample[] = []): string {
  const examplesText =
    examples.length > 0
      ? `ESEMPI DI QUERY PASSATE DELL'UTENTE E LORO ESITO:\n${examples
          .map(
            (ex, idx) =>
              `${idx + 1}. Query: "${ex.query}"\n   Esito: ${ex.outcome === 'positive' ? 'lead rilevante' : 'lead non rilevante'}${ex.reasoning ? ` — ${ex.reasoning}` : ''}`,
          )
          .join('\n')}\nUsa questi esempi per capire meglio cosa l'utente considera rilevante.`
      : ''
  return COMMERCIAL_INTENT_PROMPT.replace('{{EXAMPLES}}', examplesText).replace('{{QUERY}}', query)
}

async function callAnthropicCommercialIntent(
  query: string,
  examples: FeedbackPromptExample[] = [],
): Promise<CommercialIntent | null> {
  void query
  void examples
  // Retired: graph parsing without a search lifecycle cannot spend.
  return null
}

async function callOpenAiCommercialIntent(
  query: string,
  examples: FeedbackPromptExample[] = [],
): Promise<CommercialIntent | null> {
  return null
}

function normalizeIndustry(ind: string): string {
  const key = ind.toLowerCase().trim().replace(/[-\s]+/g, ' ')
  const map: Record<string, string> = {
    'software house': 'software',
    software: 'software',
    saas: 'software',
    'web agency': 'software',
    ecommerce: 'ecommerce',
    'e commerce': 'ecommerce',
    'e-commerce': 'ecommerce',
    ristorazione: 'ristorazione',
    ristoranti: 'ristorazione',
    ristorante: 'ristorazione',
    edilizia: 'edilizia',
    'imprese edili': 'edilizia',
    costruzioni: 'edilizia',
    edile: 'edilizia',
    delivery: 'delivery',
    'fornitura alimentare': 'fornitura alimentare',
    alimentare: 'fornitura alimentare',
    agricoltura: 'agricoltura',
    agricola: 'agricoltura',
    agroalimentare: 'agricoltura',
    'materiali edili': 'materiali edili',
    logistica: 'logistica',
    trasporti: 'logistica',
    cloud: 'cloud',
  }
  return map[key] || ind
}

function normalizeTech(t: string): string {
  const key = t.toLowerCase().trim().replace(/[-\s_]+/g, '')
  const map: Record<string, string> = {
    ga4: 'google_analytics',
    googleanalytics: 'google_analytics',
    gtm: 'google_tag_manager',
    googletagmanager: 'google_tag_manager',
    facebookpixel: 'meta_pixel',
    pixelmeta: 'meta_pixel',
    metapixel: 'meta_pixel',
    meta_pixel: 'meta_pixel',
    ssl: 'ssl',
    chatbot: 'chatbot',
    booking: 'booking',
  }
  return map[key] || t.toLowerCase().trim()
}

function isNamedGraphQuery(query: string): boolean {
  return /\b(fornitori?|clienti?|competitor|concorrenti?|partner|investitori?|dipendenti?|team|dirigenti?)\s+(?:di|dei|degli|delle)\s+['"]?[^'".,;]{2,60}['"]?/i.test(query)
}

function normalizeSignalType(type: string): string {
  const key = type.toLowerCase().replace(/[-\s]+/g, '_')
  if (key === 'funding' || key === 'investment' || key === 'financing' || key === 'raised_funding') return 'funding_received'
  if (key === 'tender' || key === 'public_tender' || key === 'tender_won' || key === 'gara' || key === 'appalto') return 'tender_won'
  if (key === 'hiring' || key === 'new_hiring' || key === 'job_opening' || key === 'assunzione') return 'hiring'
  return type
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '')).filter((v) => v.length > 0)
  }
  return []
}

function coerceNumber(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function normalizeCommercialIntent(
  raw: Record<string, unknown>,
  originalQuery: string,
  parseSource: CommercialIntent['parse_source'],
): CommercialIntent {
  const target = (raw.target_profile as Record<string, unknown>) || {}
  const companySize = (target.company_size as Record<string, unknown>) || {}

  const intent: CommercialIntent = {
    user_service_description: raw.user_service_description ? String(raw.user_service_description) : null,
    target_profile: {
      entity_types: coerceStringArray(target.entity_types) as CommercialIntent['target_profile']['entity_types'],
      roles: coerceStringArray(target.roles),
      locations: coerceStringArray(target.locations),
      industries: (target.industries ? coerceStringArray(target.industries).map(normalizeIndustry) : []),
      company_size: {
        min_employees: coerceNumber(companySize.min_employees),
        max_employees: coerceNumber(companySize.max_employees),
        revenue_min: coerceNumber(companySize.revenue_min),
        revenue_max: coerceNumber(companySize.revenue_max),
      },
    },
    signals: Array.isArray(raw.signals)
      ? raw.signals
          .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
          .map((s) => ({
            type: normalizeSignalType(String(s.type || '')),
            params: (s.params as Record<string, unknown>) || {},
            time_window_days: coerceNumber(s.time_window_days),
          }))
          .filter((s) => s.type.length > 0)
      : [],
    tech_profile: {
      has: coerceStringArray((raw.tech_profile as Record<string, unknown>)?.has).map(normalizeTech),
      missing: coerceStringArray((raw.tech_profile as Record<string, unknown>)?.missing).map(normalizeTech),
    },
    graph_constraints: Array.isArray(raw.graph_constraints)
      ? raw.graph_constraints
          .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
          .map((c) => ({
            relationship_type: String(c.relationship_type || ''),
            direction: ['incoming', 'outgoing', 'any'].includes(String(c.direction))
              ? (String(c.direction) as CommercialIntent['graph_constraints'][number]['direction'])
              : 'any',
            target_filter: (c.target_filter as Record<string, unknown>) || undefined,
          }))
          .filter((c) => {
            if (c.relationship_type.length === 0) return false
            // For non-named graph queries, drop relationship constraints that the LLM
            // often hallucinates (e.g. "buys_from" target_filter industry). Named graph
            // queries are handled by the deterministic graph plan builder instead.
            if (!isNamedGraphQuery(originalQuery)) return false
            return true
          })
      : [],
    ranking_hint: ['hottest', 'most_ready', 'largest', 'recently_active', 'closest', 'default'].includes(
      String(raw.ranking_hint),
    )
      ? (String(raw.ranking_hint) as CommercialIntent['ranking_hint'])
      : 'default',
    intent_summary: raw.intent_summary ? String(raw.intent_summary) : null,
    reasoning: raw.reasoning ? String(raw.reasoning) : null,
    confidence: Math.max(0, Math.min(1, coerceNumber(raw.confidence) ?? 0.5)),
    original_query: originalQuery,
    parse_source: parseSource,
  }

  // Se l'LLM non ha estratto location ma la query contiene una citta' italiana nota,
  // il fallback euristico puo' aiutare.
  if (!intent.target_profile.locations?.length) {
    const heuristic = parseSignalIntentHeuristic(originalQuery)
    if (heuristic.location) {
      intent.target_profile.locations = [heuristic.location]
      if (!intent.intent_summary) {
        intent.intent_summary = heuristic.intent_summary
      }
    }
    if (!intent.target_profile.industries?.length && heuristic.category) {
      intent.target_profile.industries = [heuristic.category]
    }
  }

  if (!intent.intent_summary) {
    const parts: string[] = []
    if (intent.user_service_description) parts.push(`Servizio: ${intent.user_service_description}`)
    if (intent.target_profile.industries?.length) parts.push(`Settore: ${intent.target_profile.industries.join(', ')}`)
    if (intent.target_profile.locations?.length) parts.push(`Zona: ${intent.target_profile.locations.join(', ')}`)
    if (intent.signals.length) parts.push(`Segnali: ${intent.signals.map((s) => s.type).join(', ')}`)
    intent.intent_summary = parts.length ? parts.join(' · ') : 'Ricerca commerciale'
  }

  return intent
}

function hasCommercialValue(intent: CommercialIntent): boolean {
  return (
    !!intent.user_service_description ||
    intent.signals.length > 0 ||
    (intent.target_profile.industries?.length ?? 0) > 0 ||
    (intent.target_profile.locations?.length ?? 0) > 0 ||
    intent.graph_constraints.length > 0 ||
    (intent.tech_profile.has?.length ?? 0) > 0 ||
    (intent.tech_profile.missing?.length ?? 0) > 0
  )
}

async function parseWithLlm(
  query: string,
  examples: FeedbackPromptExample[] = [],
): Promise<CommercialIntent | null> {
  const fromClaude = await callAnthropicCommercialIntent(query, examples)
  if (fromClaude && hasCommercialValue(fromClaude)) return fromClaude
  const fromOpenAi = await callOpenAiCommercialIntent(query, examples)
  if (fromOpenAi && hasCommercialValue(fromOpenAi)) return fromOpenAi
  return null
}

function heuristicFallback(query: string): CommercialIntent {
  const heuristic = parseSignalIntentHeuristic(query)
  const inferredIndustry =
    heuristic.category === 'startup'
      ? 'startup'
      : heuristic.category || heuristic.sector_keywords?.[0] || null
  const intent: CommercialIntent = {
    ...EMPTY_COMMERCIAL_INTENT,
    original_query: query,
    parse_source: 'heuristic',
    target_profile: {
      industries: inferredIndustry ? [inferredIndustry] : [],
      locations: heuristic.location ? [heuristic.location] : [],
      roles: heuristic.hiring_roles ? [...heuristic.hiring_roles] : [],
    },
    signals: heuristic.required_signals.map((s) => ({ type: s })),
    tech_profile: {
      has: [],
      missing: [],
    },
    confidence: 0.5,
  }

  if (heuristic.technical_filters) {
    const tf = heuristic.technical_filters
    for (const [key, value] of Object.entries(tf)) {
      if (key === 'technologies' && Array.isArray(value)) {
        for (const t of value) {
          if (t) intent.tech_profile.has?.push(t)
        }
      } else if (key.startsWith('has_') && value === true) {
        intent.tech_profile.has?.push(key.slice(4))
      } else if (key.startsWith('has_') && value === false) {
        intent.tech_profile.missing?.push(key.slice(4))
      } else if (key.startsWith('missing_') && value === true) {
        intent.tech_profile.missing?.push(key.slice(8))
      }
    }
  }

  // Convert hiring roles into typed hiring signals so the query builder can filter jobs.
  if (heuristic.hiring_roles?.length && heuristic.required_signals.includes('hiring')) {
    intent.signals = intent.signals.filter((s) => s.type !== 'hiring')
    for (const role of heuristic.hiring_roles) {
      if (role) intent.signals.push({ type: 'hiring', params: { role } })
    }
  }

  // Preserve size filters extracted by the heuristic parser.
  const bf = heuristic.business_filters
  if (bf) {
    intent.target_profile.company_size = {
      min_employees: bf.employees_min ?? undefined,
      max_employees: bf.employees_max ?? undefined,
      revenue_min: bf.revenue_min ?? undefined,
      revenue_max: bf.revenue_max ?? undefined,
    }
  }

  return enrichCommercialIntentFromSellerQuery(
    query,
    normalizeCommercialIntent(intent as unknown as Record<string, unknown>, query, 'heuristic'),
  )
}

/** Parser universale per query commerciali in linguaggio naturale. */
export async function parseCommercialIntent(
  query: string,
  examples: FeedbackPromptExample[] = [],
): Promise<CommercialIntent> {
  const q = (query || '').trim()
  if (!q) return { ...EMPTY_COMMERCIAL_INTENT }

  const hasExamples = examples.length > 0
  const cacheKey = hasExamples ? `${q.toLowerCase()}::ex:${examples.length}` : q.toLowerCase()
  const cached = commercialCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result
  }

  const fromLlm = await parseWithLlm(q, examples)
  const result = fromLlm ?? heuristicFallback(q)

  commercialCache.set(cacheKey, { result, ts: Date.now() })
  return result
}

/** Versione offline per ambienti senza LLM key. */
export function parseCommercialIntentOffline(query: string): CommercialIntent {
  return heuristicFallback(query)
}
