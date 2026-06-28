import type { MiraxSignalRequirement, SignalIntentSpec } from './types.ts'
import { EMPTY_SIGNAL_INTENT } from './types.ts'

const VALID_SIGNALS = new Set<MiraxSignalRequirement>([
  'hiring',
  'registry_change',
  'sector_investment',
  'tender_won',
  'crm_detected',
  'crm_change',
  'site_stale',
  'meta_ads_started',
  'google_ads_started',
  'investing_marketing',
])

function mapLooseSignal(raw: string): MiraxSignalRequirement | null {
  const s = raw.toLowerCase().replace(/-/g, '_')
  if (VALID_SIGNALS.has(s as MiraxSignalRequirement)) return s as MiraxSignalRequirement
  if (s === 'executive_change' || s === 'expansion' || s === 'new_location') return 'registry_change'
  if (s === 'funding_received' || s === 'funding_news') return 'sector_investment'
  return null
}

/** Fallback offline quando Claude non è disponibile — interpreta sinonimi e contesto. */
export function inferFromSemanticGraph(query: string): SignalIntentSpec {
  const q = (query || '').trim()
  const lower = q.toLowerCase()
  if (!q) return { ...EMPTY_SIGNAL_INTENT, parse_source: 'semantic_graph' }

  const required_signals: MiraxSignalRequirement[] = []
  const hiring_roles: string[] = []
  const sector_keywords: string[] = []
  const crm_keywords: string[] = []

  if (
    /\b(assum\w*|assunz\w*|organico|personale|hiring|recruit\w*|venditor\w*|commercial\w*|programmator\w*|developer\w*)\b/i.test(q)
  ) {
    required_signals.push('hiring')
  }
  if (/\bvenditor\w*\b/i.test(q)) hiring_roles.push('commerciale')
  if (/\bprogrammator\w*|developer\w*\b/i.test(q)) hiring_roles.push('programmatore')

  if (/\b(successione\s+generazionale|dirigent|ceo|cambio\s+ceo|nuovo\s+amministratore)\b/i.test(q)) {
    required_signals.push('registry_change')
  }

  if (
    /\b(software|crm|digitalizz|gestire\s+i\s+clienti|gestione\s+clienti|nuovo\s+software)\b/i.test(q) ||
    /\bcrm\b/i.test(q)
  ) {
    if (/\b(camb|nuov|migr|sostitu|cerc\w*)\b/i.test(q)) required_signals.push('crm_change')
    else required_signals.push('crm_detected')
  }
  if (/\bhubspot\b/i.test(q)) crm_keywords.push('hubspot')
  if (/\bsalesforce\b/i.test(q)) crm_keywords.push('salesforce')

  if (/\b(gar\w*|appalt\w*|aggiudicat\w*|vinc\w*|bando\s+pubblic\w*)\b/i.test(q)) {
    required_signals.push('tender_won')
  }

  if (/\b(funding|investimento|round|finanziamento|ricevuto\s+funding|startup)\b/i.test(q)) {
    required_signals.push('sector_investment')
  }

  if (/\b(espansion|nuova\s+sede|filiale|apertura\s+sede)\b/i.test(q)) {
    required_signals.push('registry_change')
  }

  if (/\b(esport\w*|germania|francia|internazional)\b/i.test(q)) {
    required_signals.push('sector_investment')
    if (/\bgermania\b/i.test(q)) sector_keywords.push('germania')
    if (/\bfrancia\b/i.test(q)) sector_keywords.push('francia')
  }

  if (/\b(bmw|stellantis|automotive|fornitori\s+auto)\b/i.test(q)) {
    sector_keywords.push('automotive')
    if (/\bbmw\b/i.test(q)) sector_keywords.push('bmw')
    if (/\bstellantis\b/i.test(q)) sector_keywords.push('stellantis')
    if (!required_signals.includes('sector_investment')) required_signals.push('sector_investment')
  }

  if (/\b(fotovoltaic|manifattur|industrial)\b/i.test(q)) {
    sector_keywords.push(/\bfotovoltaic/i.test(q) ? 'fotovoltaico' : 'manifattura')
    if (!required_signals.includes('sector_investment')) required_signals.push('sector_investment')
  }

  if (/\b(sito\s+datato|sito\s+vecchio|obsoleto)\b/i.test(q)) {
    required_signals.push('site_stale')
  }

  const technical_filters: SignalIntentSpec['technical_filters'] = {}
  if (/\b(senza\s+gtm|no\s+gtm)\b/i.test(q)) technical_filters.has_gtm = false
  if (/\b(senza\s+(meta\s*)?pixel|no\s+pixel)\b/i.test(q)) technical_filters.has_meta_pixel = false
  if (/\b(senza\s+ssl|no\s+ssl)\b/i.test(q)) technical_filters.has_ssl = false
  if (/\b(errori?\s*seo|seo\s*error|con\s+errori)\b/i.test(q)) technical_filters.errors_seo = true
  if (/\b(sito\s+lento|slow)\b/i.test(q)) technical_filters.site_speed = 'slow'
  if (/\b(non\s+mobile|mobile.friendly\s*false|senza\s+mobile)\b/i.test(q)) {
    technical_filters.mobile_friendly = false
  }
  if (/\b(senza\s+analytics|no\s+analytics|senza\s+ga4)\b/i.test(q)) {
    technical_filters.has_google_analytics = false
  }

  const social_filters: SignalIntentSpec['social_filters'] = {}
  if (/\b(senza\s+instagram|no\s+instagram)\b/i.test(q)) social_filters.has_instagram = false
  if (/\b(senza\s+facebook|no\s+facebook)\b/i.test(q)) social_filters.has_facebook = false
  if (/\b(senza\s+linkedin|no\s+linkedin)\b/i.test(q)) social_filters.has_linkedin = false
  if (/\b(recensioni?\s+negative|bad\s+review)\b/i.test(q)) social_filters.reviews_negative = true
  if (/\b(senza\s+(sito|website)|non\s+hanno\s+sito|no\s+website)\b/i.test(q)) {
    if (!required_signals.includes('site_stale')) required_signals.push('site_stale')
  }
  if (/\b(digitalizz)\b/i.test(q) && !required_signals.includes('crm_change')) {
    required_signals.push('crm_change')
  }

  const business_filters: SignalIntentSpec['business_filters'] = {}
  const revMin = lower.match(/fatturato\s+(?:sopra|>|oltre|minimo)\s+([\d.,]+)\s*(milioni|m|k)?/i)
  if (revMin) {
    let n = parseFloat(revMin[1].replace(/\./g, '').replace(',', '.'))
    const unit = (revMin[2] || '').toLowerCase()
    if (unit.startsWith('mil') || unit === 'm') n *= 1_000_000
    if (unit === 'k') n *= 1_000
    if (Number.isFinite(n)) business_filters.revenue_min = Math.round(n)
  }
  if (/\bpmi\b/i.test(q)) {
    business_filters.revenue_max = 50_000_000
    business_filters.employees_max = 250
  }
  if (/\bstartup\b/i.test(q)) business_filters.founded_after = '2020-01-01'
  const empMatch = q.match(/\bpiù\s+di\s+(\d+)\s+dipendenti\b/i)
  if (empMatch) business_filters.employees_min = parseInt(empMatch[1], 10)

  let category: string | null = null
  let location: string | null = null
  const locMatch = q.match(/\b(?:a|ad|in)\s+([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zà-ÿ]+)?)\b/)
  if (locMatch) location = locMatch[1]

  const catPatterns: Array<[RegExp, string]> = [
    [/\bconcessionari\w*\s+auto\b/i, 'concessionarie auto'],
    [/\bimprese?\s+edil\w*\b/i, 'imprese edili'],
    [/\bagenzie?\s+(di\s+)?marketing\b/i, 'agenzie marketing'],
    [/\bagenzie?\s+(di\s+)?viagg\w*\b/i, 'agenzie viaggi'],
    [/\bristorant\w*\b/i, 'ristoranti'],
    [/\bpmi\s+manifatturier\w*\b/i, 'PMI manifatturiere'],
    [/\bstartup\s+tech\b/i, 'startup tech'],
    [/\bfornitori?\s+automotive\b/i, 'fornitori automotive'],
    [/\bartigian\w*\b/i, 'artigiani'],
    [/\bconsulenz\w*\b/i, 'aziende di consulenza'],
  ]
  for (const [re, label] of catPatterns) {
    if (re.test(q)) {
      category = label
      break
    }
  }

  return {
    required_signals: [...new Set(required_signals)],
    hiring_roles: [...new Set(hiring_roles)],
    sector_keywords: [...new Set(sector_keywords)],
    crm_keywords: [...new Set(crm_keywords)],
    require_crm_change: required_signals.includes('crm_change'),
    time_window_days: required_signals.includes('tender_won') ? 365 : null,
    intent_summary: null,
    category,
    location,
    technical_filters,
    social_filters,
    business_filters,
    reasoning: 'Interpretato via semantic graph fallback',
    parse_source: 'semantic_graph',
  }
}

export function normalizeClaudeSignalIntent(raw: Record<string, unknown>): SignalIntentSpec {
  const base = inferFromSemanticGraph('')
  const signalsRaw = Array.isArray(raw.required_signals) ? raw.required_signals : []
  const required_signals = signalsRaw
    .map((s) => (typeof s === 'string' ? mapLooseSignal(s) : null))
    .filter((s): s is MiraxSignalRequirement => Boolean(s))

  const tf = raw.technical_filters && typeof raw.technical_filters === 'object'
    ? (raw.technical_filters as Record<string, unknown>)
    : {}
  const sf = raw.social_filters && typeof raw.social_filters === 'object'
    ? (raw.social_filters as Record<string, unknown>)
    : {}
  const bf = raw.business_filters && typeof raw.business_filters === 'object'
    ? (raw.business_filters as Record<string, unknown>)
    : {}

  const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
  const asNum = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

  return {
    ...base,
    required_signals: [...new Set(required_signals)],
    hiring_roles: Array.isArray(raw.hiring_roles)
      ? raw.hiring_roles.filter((x): x is string => typeof x === 'string')
      : base.hiring_roles,
    sector_keywords: Array.isArray(raw.sector_keywords)
      ? raw.sector_keywords.filter((x): x is string => typeof x === 'string')
      : base.sector_keywords,
    crm_keywords: Array.isArray(raw.crm_keywords)
      ? raw.crm_keywords.filter((x): x is string => typeof x === 'string')
      : base.crm_keywords,
    require_crm_change: required_signals.includes('crm_change'),
    time_window_days:
      typeof raw.time_window_days === 'number' ? Math.round(raw.time_window_days) : base.time_window_days,
    category: asStr(raw.category) ?? base.category,
    location: asStr(raw.location) ?? base.location,
    technical_filters: {
      has_gtm: asBool(tf.has_gtm),
      has_meta_pixel: asBool(tf.has_meta_pixel),
      has_google_analytics: asBool(tf.has_google_analytics),
      has_ssl: asBool(tf.has_ssl),
      errors_seo: asBool(tf.errors_seo),
      site_speed: tf.site_speed === 'fast' || tf.site_speed === 'slow' ? tf.site_speed : null,
      mobile_friendly: asBool(tf.mobile_friendly),
    },
    social_filters: {
      has_instagram: asBool(sf.has_instagram),
      has_facebook: asBool(sf.has_facebook),
      has_linkedin: asBool(sf.has_linkedin),
      reviews_negative: asBool(sf.reviews_negative),
      social_followers_low: asBool(sf.social_followers_low),
    },
    business_filters: {
      revenue_min: asNum(bf.revenue_min),
      revenue_max: asNum(bf.revenue_max),
      employees_min: asNum(bf.employees_min),
      employees_max: asNum(bf.employees_max),
      founded_after: asStr(bf.founded_after),
      founded_before: asStr(bf.founded_before),
    },
    reasoning: asStr(raw.reasoning) ?? 'Interpretato via MIRAX Semantic Engine',
    parse_source: 'semantic_ai',
  }
}
