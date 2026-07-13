import {
  CRM_KEYWORD_EXTRACTORS,
  HIRING_ROLE_PATTERNS,
  NL_SIGNAL_PATTERNS,
  SECTOR_KEYWORD_EXTRACTORS,
} from '@/lib/signal-intent/catalog'
import {
  EMPTY_SIGNAL_INTENT,
  type IntentBusinessFilters,
  type IntentSocialFilters,
  type IntentTechnicalFilters,
  type MiraxSignalRequirement,
  type SignalIntentSpec,
} from '@/lib/signal-intent/types'
import { isBuyerMarketingInvestmentQuery } from '@/lib/signal-intent/marketing-investment'

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

function extractTimeWindowDays(query: string): number | null {
  const q = query.toLowerCase()
  const m30 = q.match(/\b(ultim[oi]\s+)?30\s+giorni\b/)
  if (m30) return 30
  const m60 = q.match(/\b(ultim[oi]\s+)?60\s+giorni\b/)
  if (m60) return 60
  const m90 = q.match(/\b(ultim[oi]\s+)?90\s+giorni\b/)
  if (m90) return 90
  const mYear = q.match(/\b(ultim[oa]\s+)?anno\b/)
  if (mYear) return 365
  const mMonths = q.match(/\bultim[oi]\s+(\d{1,2})\s+mesi\b/)
  if (mMonths) return Math.min(730, parseInt(mMonths[1], 10) * 30)
  return null
}

function extractTechnicalFilters(q: string): IntentTechnicalFilters {
  const f: IntentTechnicalFilters = {}
  const neg = /\b(non\s+|senza\s+|manca\s+|nessun\s+|no\s+)/i
  const clause = (phrase: string) => {
    const before = q.slice(0, q.toLowerCase().indexOf(phrase.toLowerCase()))
    return neg.test(before.slice(-30))
  }

  if (/\bgoogle\s+analytics\b|\bga4\b/i.test(q)) f.has_google_analytics = !clause('google analytics') && !clause('ga4')
  if (/\b(tag\s+manager|gtm|google\s+tag\s+manager)\b/i.test(q)) f.has_gtm = !clause('tag manager') && !clause('gtm')
  if (/\bmeta\s+pixel\b|\bfacebook\s+pixel\b|\bpixel\s+meta\b/i.test(q)) f.has_meta_pixel = !clause('meta pixel') && !clause('facebook pixel')
  if (/\bssl\b|\bcertificato\s+ssl\b/i.test(q)) f.has_ssl = !clause('ssl')
  if (/\bsito\s+lento\b|\bcaricamento\s+lento\b|\blento\s+a\s+caricare\b|\bload\s+speed\s+slow\b/i.test(q)) {
    f.site_speed = 'slow'
    f.load_speed_slow = true
  }
  if (/\bsito\s+veloce\b|\bcaricamento\s+veloce\b/i.test(q)) f.site_speed = 'fast'
  if (/\bmobile\s+friendly\b|\bmobile\s+friendly\b|\bresponsiv/i.test(q)) f.mobile_friendly = !clause('mobile')
  if (/\berrori\s+seo\b|\bseo\s+disaster\b|\bproblemi\s+seo\b/i.test(q)) f.errors_seo = true
  if (/\bchatbot\b|\bchat\s+bot\b/i.test(q)) f.has_chatbot = !clause('chatbot')
  if (/\bbooking\b|\bprenotazione\s+online\b/i.test(q)) f.has_booking = !clause('booking')

  const techPatterns: Array<[RegExp, string]> = [
    [/\bwordpress\b/i, 'wordpress'],
    [/\bshopify\b/i, 'shopify'],
    [/\b(?:react\.js|reactjs|react)\b/i, 'react'],
    [/\bangular\b/i, 'angular'],
    [/\bvue(?:\.js|js)?\b/i, 'vue'],
    [/\bprestashop\b/i, 'prestashop'],
    [/\bmagento\b/i, 'magento'],
    [/\bsalesforce\b/i, 'salesforce'],
    [/\bhubspot\b/i, 'hubspot'],
    [/\bzoho\b/i, 'zoho'],
  ]
  const detected = techPatterns.filter(([re]) => re.test(q)).map(([, name]) => name)
  if (detected.length) f.technologies = unique(detected)

  // Clean nulls
  for (const k of Object.keys(f) as Array<keyof IntentTechnicalFilters>) {
    if (f[k] === null || f[k] === undefined) delete f[k]
  }
  return f
}

function extractSocialFilters(q: string): IntentSocialFilters {
  const f: IntentSocialFilters = {}
  const neg = /\b(non\s+|senza\s+|manca\s+|nessun\s+|no\s+)/i
  const clause = (phrase: string) => {
    const idx = q.toLowerCase().indexOf(phrase.toLowerCase())
    if (idx < 0) return false
    const before = q.slice(0, idx)
    return neg.test(before.slice(-30))
  }

  if (/\binstagram\b/i.test(q)) {
    f.has_instagram = !clause('instagram')
    if (clause('instagram')) f.missing_instagram = true
  }
  if (/\bfacebook\b/i.test(q)) {
    f.has_facebook = !clause('facebook')
    if (clause('facebook')) f.missing_facebook = true
  }
  if (/\blinkedin\b/i.test(q)) {
    f.has_linkedin = !clause('linkedin')
    if (clause('linkedin')) f.missing_linkedin = true
  }
  if (/\brecensioni\s+negative\b|\breputazion\b|\b1\s+stella\b/i.test(q)) f.reviews_negative = true
  if (/\bpoco\s+seguit\b|\bsocial\s+piccol\b|\bpochi\s+follower\b/i.test(q)) f.social_followers_low = true

  for (const k of Object.keys(f) as Array<keyof IntentSocialFilters>) {
    if (f[k] === null || f[k] === undefined) delete f[k]
  }
  return f
}

function parseRevenueAmount(value: string, unit: string): number {
  const n = parseFloat(value.replace(/\./g, '').replace(/,/g, '.'))
  if (!unit) return n
  const u = unit.toLowerCase()
  if (u.startsWith('milion')) return n * 1_000_000
  if (u.startsWith('miliard')) return n * 1_000_000_000
  if (u === 'k') return n * 1_000
  if (u === 'm') return n * 1_000_000
  if (u === 'b') return n * 1_000_000_000
  return n
}

function extractBusinessFilters(q: string): IntentBusinessFilters {
  const f: IntentBusinessFilters = {}

  const revMin = q.match(/\bfatturato\s+(superiore\s+a|oltre|>)\s*([\d\.]+)([kKmMbB]?)\b/i)
  if (revMin) f.revenue_min = parseRevenue(revMin[2], revMin[3])
  const revMax = q.match(/\bfatturato\s+(inferiore\s+a|sotto|<)\s*([\d\.]+)([kKmMbB]?)\b/i)
  if (revMax) f.revenue_max = parseRevenue(revMax[2], revMax[3])

  // Spoken Italian variants: "fatturato superiore a 1 milione", "oltre 2 milioni di fatturato".
  const revMinWords = q.match(/\bfatturato\s+(superiore\s+a|oltre|>)\s*([\d\.]+)\s*(milion[ei]|miliard[oi])\b/i)
  if (revMinWords) f.revenue_min = parseRevenueAmount(revMinWords[2], revMinWords[3])
  const revMaxWords = q.match(/\bfatturato\s+(inferiore\s+a|sotto|<)\s*([\d\.]+)\s*(milion[ei]|miliard[oi])\b/i)
  if (revMaxWords) f.revenue_max = parseRevenueAmount(revMaxWords[2], revMaxWords[3])
  const revMinAlt = q.match(/\b(oltre|superiore\s+a|>)\s*([\d\.]+)\s*(milion[ei]|miliard[oi])\s+(?:di\s+)?fatturato\b/i)
  if (revMinAlt) f.revenue_min = parseRevenueAmount(revMinAlt[2], revMinAlt[3])
  const revMaxAlt = q.match(/\b(sotto|inferiore\s+a|<)\s*([\d\.]+)\s*(milion[ei]|miliard[oi])\s+(?:di\s+)?fatturato\b/i)
  if (revMaxAlt) f.revenue_max = parseRevenueAmount(revMaxAlt[2], revMaxAlt[3])

  const empMin = q.match(/\b(dipendent[ei]|dipendenti)\s+(oltre|superiore\s+a|>|più\s+di)\s*(\d+)\b/i)
  if (empMin) f.employees_min = parseInt(empMin[3], 10)
  const empMax = q.match(/\b(dipendent[ei]|dipendenti)\s+(sotto|inferiore\s+a|<|meno\s+di)\s*(\d+)\b/i)
  if (empMax) f.employees_max = parseInt(empMax[3], 10)

  // Spoken variants: "con più di 10 dipendenti", "oltre 10 dipendenti".
  const empMinAlt = q.match(/\b(oltre|superiore\s+a|>|più\s+di)\s*(\d+)\s+dipendent[ei]\b/i)
  if (empMinAlt) f.employees_min = parseInt(empMinAlt[2], 10)
  const empMaxAlt = q.match(/\b(sotto|inferiore\s+a|<|meno\s+di)\s*(\d+)\s+dipendent[ei]\b/i)
  if (empMaxAlt) f.employees_max = parseInt(empMaxAlt[2], 10)

  const foundedAfter = q.match(/\b(fondata\s+dopo|nata\s+dopo)\s+(\d{4})\b/i)
  if (foundedAfter) f.founded_after = `${foundedAfter[2]}-01-01`
  const foundedBefore = q.match(/\b(fondata\s+prima|nata\s+prima)\s+(\d{4})\b/i)
  if (foundedBefore) f.founded_before = `${foundedBefore[2]}-01-01`

  for (const k of Object.keys(f) as Array<keyof IntentBusinessFilters>) {
    if (f[k] === null || f[k] === undefined) delete f[k]
  }
  return f
}

function parseRevenue(value: string, suffix: string): number {
  const n = parseFloat(value.replace(/\./g, '').replace(/,/g, '.'))
  const s = suffix.toLowerCase()
  if (s === 'k') return n * 1_000
  if (s === 'm') return n * 1_000_000
  if (s === 'b') return n * 1_000_000_000
  return n
}

function buildSummary(spec: SignalIntentSpec): string | null {
  const parts: string[] = []
  if (spec.required_signals.length) {
    parts.push(`Segnali: ${spec.required_signals.join(', ')}`)
  }
  if (spec.hiring_roles.length) parts.push(`Ruoli: ${spec.hiring_roles.join(', ')}`)
  if (spec.sector_keywords.length) parts.push(`Settore: ${spec.sector_keywords.join(', ')}`)
  if (spec.crm_keywords.length) parts.push(`CRM: ${spec.crm_keywords.join(', ')}`)
  if (spec.time_window_days) parts.push(`Finestra: ${spec.time_window_days}g`)

  const tf = spec.technical_filters
  if (tf?.has_meta_pixel === false) parts.push('Senza Meta Pixel')
  if (tf?.has_meta_pixel === true) parts.push('Con Meta Pixel')
  if (tf?.has_gtm === false) parts.push('Senza Google Tag Manager')
  if (tf?.has_gtm === true) parts.push('Con Google Tag Manager')
  if (tf?.has_google_analytics === false) parts.push('Senza Google Analytics')
  if (tf?.has_google_analytics === true) parts.push('Con Google Analytics')
  if (tf?.site_speed === 'slow') parts.push('Sito lento')
  if (tf?.site_speed === 'fast') parts.push('Sito veloce')
  if (tf?.has_ssl === false) parts.push('Senza SSL')
  if (tf?.has_ssl === true) parts.push('Con SSL')
  if (tf?.errors_seo) parts.push('Errori SEO')
  if (tf?.has_chatbot === true) parts.push('Con chatbot')
  if (tf?.has_chatbot === false) parts.push('Senza chatbot')
  if (tf?.has_booking === true) parts.push('Con booking')
  if (tf?.has_booking === false) parts.push('Senza booking')

  const sf = spec.social_filters
  if (sf?.missing_instagram) parts.push('Senza Instagram')
  if (sf?.has_instagram) parts.push('Con Instagram')
  if (sf?.missing_facebook) parts.push('Senza Facebook')
  if (sf?.has_facebook) parts.push('Con Facebook')
  if (sf?.missing_linkedin) parts.push('Senza LinkedIn')
  if (sf?.has_linkedin) parts.push('Con LinkedIn')
  if (sf?.reviews_negative) parts.push('Recensioni negative')
  if (sf?.social_followers_low) parts.push('Poco social')

  const bf = spec.business_filters
  if (bf?.revenue_min) parts.push(`Fatturato > ${bf.revenue_min.toLocaleString('it-IT')}€`)
  if (bf?.revenue_max) parts.push(`Fatturato < ${bf.revenue_max.toLocaleString('it-IT')}€`)
  if (bf?.employees_min) parts.push(`Dipendenti > ${bf.employees_min}`)
  if (bf?.employees_max) parts.push(`Dipendenti < ${bf.employees_max}`)
  if (bf?.founded_after) parts.push(`Fondata dopo ${bf.founded_after.slice(0, 4)}`)
  if (bf?.founded_before) parts.push(`Fondata prima ${bf.founded_before.slice(0, 4)}`)

  return parts.length ? parts.join(' · ') : null
}

/** Parser rule-based — funziona offline, merge con output LLM. */
export function parseSignalIntentHeuristic(userQuery: string): SignalIntentSpec {
  const q = (userQuery || '').trim()
  if (!q) return { ...EMPTY_SIGNAL_INTENT }
  const buyerVerb = q.match(/\b(?:trovami|cercami|trova|cerca)\b/i)
  const sellerFramed = /^\s*(?:sono\b|vendo\b|offro\b|fornisco\b)/i.test(q)
  const signalQ = sellerFramed && buyerVerb?.index !== undefined ? q.slice(buyerVerb.index) : q

  const required_signals: MiraxSignalRequirement[] = []
  const excluded_signals: MiraxSignalRequirement[] = []
  for (const entry of NL_SIGNAL_PATTERNS) {
    for (const pattern of entry.patterns) {
      const m = signalQ.match(pattern)
      if (!m) continue
      const matchStart = m.index ?? 0
      // Negation is local to the matched signal. A broad look-behind made
      // unrelated exclusions such as "PMI non famose con sito debole" negate
      // the website signal because the word "non" happened to be nearby.
      const context = signalQ.slice(Math.max(0, matchStart - 32), matchStart).toLowerCase()
      const negated = /\b(?:non|senza|no|nessun[aoei]?|manca(?:no)?)\s+(?:(?:hanno|ha|avere|con|il|lo|la|i|gli|le|un|una)\s+){0,2}$/.test(context)
      if (negated) {
        excluded_signals.push(entry.requirement)
      } else {
        required_signals.push(entry.requirement)
      }
    }
  }
  if (required_signals.some((signal) => [
    'hiring_operational', 'hiring_technology', 'hiring_sales', 'hiring_marketing',
  ].includes(signal))) {
    const genericHiring = required_signals.indexOf('hiring')
    if (genericHiring >= 0) required_signals.splice(genericHiring, 1)
  }

  const hiring_roles: string[] = []
  const buyerMarketingSpend = isBuyerMarketingInvestmentQuery(signalQ)
  for (const entry of HIRING_ROLE_PATTERNS) {
    if (buyerMarketingSpend && entry.role === 'marketing') continue
    if (entry.patterns.some((p) => p.test(signalQ))) hiring_roles.push(entry.role)
  }
  // Freelancer / "chi ha bisogno di me" → cerca aziende che assumono quel ruolo
  const FREELANCER_NEED =
    /\b(sono\s+(?:un['’]?\s*|una\s+)|potrebbero\s+aver\s+bisogno|che\s+potrebbero\s+aver\s+bisogno|freelanc\w*|libero\s+profession\w*)/i
  if (!buyerVerb && hiring_roles.length && FREELANCER_NEED.test(q) && !required_signals.includes('hiring')) {
    required_signals.push('hiring')
  }

  const sector_keywords: string[] = []
  for (const entry of SECTOR_KEYWORD_EXTRACTORS) {
    if (entry.patterns.some((p) => p.test(signalQ))) sector_keywords.push(entry.keyword)
  }

  let category: string | null = null
  let location: string | null = null
  const stopWords = 'che|con|per|da|di|a|ad|in|su|e|o'
  const nonGeoWords =
    /^(marketing|software|digitale|crescita|espansione|vendite|cloud|crm|seo|ads|pubblicit\w*|assunzion\w*|hiring|personale)$/i
  const locMatch = signalQ.match(
    new RegExp(`\\b(?:a|ad|in)\\s+([A-Za-zÀ-ÿ]+)(?:\\s+(?!${stopWords}\\b)[A-Za-zÀ-ÿ]+)?\\b`, 'i'),
  )
  if (locMatch) {
    const candidate = locMatch[1].trim()
    const investInMarketing =
      /\binvest\w*\s+in\s+marketing\b/i.test(signalQ) && candidate.toLowerCase() === 'marketing'
    if (!investInMarketing && !nonGeoWords.test(candidate)) {
      location = candidate
    }
  }
  const catPatterns: Array<[RegExp, string]> = [
    [/\bagenzie?\s+(di\s+)?marketing\b/i, 'agenzie marketing'],
    ...(buyerMarketingSpend ? [] : [[/\bagenzie?\b.*\bmarketing\b/i, 'agenzie marketing'] as [RegExp, string]]),
    [/\bstartup\b/i, 'startup'],
    [/\bimprese?\s+edil\w*\b/i, 'imprese edili'],
    [/\bsoftware\s+house\b/i, 'software house'],
    [/\bweb\s+agenc\w*\b/i, 'web agency'],
    [/\b(ristorant\w*|ristorazion\w*)\b/i, 'ristoranti'],
  ]
  for (const [re, label] of catPatterns) {
    if (re.test(signalQ)) {
      category = label
      break
    }
  }

  if (sector_keywords.length && !required_signals.includes('sector_investment')) {
    const investIntent = /\b(invest|investono|investimento|investe\s+in|puntano\s+su|puntare\s+su)\b/i.test(signalQ)
    const vagueDigitalInvestment = /\binvestimento\s+digitale\b|\binvest\w*\s+(?:nel|in)\s+digitale\b/i.test(signalQ)
    if (investIntent && !(vagueDigitalInvestment && sector_keywords.every((keyword) => keyword === 'software'))) {
      required_signals.push('sector_investment')
    }
  }

  const crm_keywords: string[] = []
  for (const entry of CRM_KEYWORD_EXTRACTORS) {
    if (entry.patterns.some((p) => p.test(signalQ))) crm_keywords.push(entry.crm)
  }

  const require_crm_change =
    (/\b(cambiat\w*|migrat\w*|nuovo\s+crm|switch|sostituit\w*)\b/i.test(signalQ) &&
      (/\bcrm\b/i.test(signalQ) || crm_keywords.length > 0)) ||
    required_signals.includes('crm_change')

  if (require_crm_change && !required_signals.includes('crm_change')) {
    required_signals.push('crm_change')
  } else if (crm_keywords.length && !required_signals.includes('crm_detected')) {
    required_signals.push('crm_detected')
  }

  if (require_crm_change) {
    const idx = required_signals.indexOf('crm_detected')
    if (idx >= 0 && crm_keywords.length === 0) required_signals.splice(idx, 1)
  }

  let time_window_days = extractTimeWindowDays(signalQ)
  if (required_signals.includes('tender_won') && !time_window_days) {
    time_window_days = 365
  }
  if (require_crm_change && !time_window_days) {
    time_window_days = 30
  }

  const technical_filters = extractTechnicalFilters(signalQ)
  const social_filters = extractSocialFilters(signalQ)
  const business_filters = extractBusinessFilters(signalQ)

  const spec: SignalIntentSpec = {
    required_signals: unique(required_signals),
    hiring_roles: unique(hiring_roles),
    sector_keywords: unique(sector_keywords),
    crm_keywords: unique(crm_keywords),
    require_crm_change,
    time_window_days,
    intent_summary: null,
    category,
    location,
    technical_filters,
    social_filters,
    business_filters,
  }
  spec.intent_summary = buildSummary(spec)
  return spec
}

export function mergeSignalIntent(a: SignalIntentSpec, b: SignalIntentSpec): SignalIntentSpec {
  const merged: SignalIntentSpec = {
    required_signals: unique([...a.required_signals, ...b.required_signals]),
    hiring_roles: unique([...a.hiring_roles, ...b.hiring_roles]),
    sector_keywords: unique([...a.sector_keywords, ...b.sector_keywords]),
    crm_keywords: unique([...a.crm_keywords, ...b.crm_keywords]),
    require_crm_change: a.require_crm_change || b.require_crm_change,
    time_window_days: a.time_window_days ?? b.time_window_days,
    intent_summary: null,
    technical_filters: { ...(a.technical_filters || {}), ...(b.technical_filters || {}) },
    social_filters: { ...(a.social_filters || {}), ...(b.social_filters || {}) },
    business_filters: { ...(a.business_filters || {}), ...(b.business_filters || {}) },
  }
  merged.intent_summary = buildSummary(merged) || a.intent_summary || b.intent_summary
  return merged
}

export function coerceSignalIntent(raw: unknown): SignalIntentSpec {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SIGNAL_INTENT }
  const o = raw as Record<string, unknown>
  const asReq = (v: unknown): MiraxSignalRequirement[] =>
    Array.isArray(v)
      ? v.filter((x): x is MiraxSignalRequirement => typeof x === 'string')
      : []
  const asStr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).map((s) => s.trim()) : []

  const spec: SignalIntentSpec = {
    required_signals: asReq(o.required_signals),
    hiring_roles: asStr(o.hiring_roles),
    sector_keywords: asStr(o.sector_keywords),
    crm_keywords: asStr(o.crm_keywords),
    require_crm_change: o.require_crm_change === true,
    time_window_days:
      typeof o.time_window_days === 'number' && Number.isFinite(o.time_window_days)
        ? Math.round(o.time_window_days)
        : null,
    intent_summary: typeof o.intent_summary === 'string' ? o.intent_summary : null,
    category: typeof o.category === 'string' ? o.category : null,
    location: typeof o.location === 'string' ? o.location : null,
    technical_filters:
      o.technical_filters && typeof o.technical_filters === 'object'
        ? (o.technical_filters as SignalIntentSpec['technical_filters'])
        : {},
    social_filters:
      o.social_filters && typeof o.social_filters === 'object'
        ? (o.social_filters as SignalIntentSpec['social_filters'])
        : {},
    business_filters:
      o.business_filters && typeof o.business_filters === 'object'
        ? (o.business_filters as SignalIntentSpec['business_filters'])
        : {},
    reasoning: typeof o.reasoning === 'string' ? o.reasoning : null,
    parse_source:
      o.parse_source === 'heuristic' ||
      o.parse_source === 'semantic_ai' ||
      o.parse_source === 'semantic_graph' ||
      o.parse_source === 'merged'
        ? o.parse_source
        : undefined,
  }
  if (!spec.intent_summary) spec.intent_summary = buildSummary(spec)
  return spec
}
