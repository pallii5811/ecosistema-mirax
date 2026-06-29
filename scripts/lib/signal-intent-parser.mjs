/**
 * Mirror of src/lib/signal-intent/catalog.ts + parse-heuristic.ts for Node tests.
 */
export const NL_SIGNAL_PATTERNS = [
  {
    requirement: 'hiring',
    patterns: [
      /\b(assum|assunz|assumendo|assunzioni|assumono|offerte?\s+(di\s+)?lavoro|job\s+open|recruit\w*|hiring|personale)\b/i,
      /\b(programmator|developer|commercial|venditor|marketing\s+manager|tecnici|infermier)\b/i,
    ],
  },
  {
    requirement: 'registry_change',
    patterns: [
      /\b(registro|camera\s+di\s+commercio|bilancio|fatturato|crescita\s+organico|dipendenti\s+in\s+aumento)\b/i,
    ],
  },
  {
    requirement: 'sector_investment',
    patterns: [
      /\b(invest|investono|investimento|puntano\s+su|espansione\s+in)\b/i,
      /\b(fotovoltaic|fotovoltaico|pannelli\s+solari|impianti\s+solari|solare|rinnovabil|energia\s+pulita)\b/i,
      /\b(intelligenza\s+artificiale|\bai\b|machine\s+learning|automazion)\b/i,
    ],
  },
  {
    requirement: 'tender_won',
    patterns: [
      /\b(gara|appalto|aggiudicat\w*|vincit\w*|bando\s+pubblic\w*|lavori\s+pubblici|pubblica\s+amministrazione|anac|mepa)\b/i,
    ],
  },
  {
    requirement: 'crm_change',
    patterns: [
      /\b(cambiat\w*\s+crm|nuovo\s+crm|migrat\w*\s+(a|su|verso|da)?|switch\s+crm|sostituit\w*\s+crm)\b/i,
    ],
  },
  {
    requirement: 'crm_detected',
    patterns: [/\b(crm|hubspot|salesforce|pipedrive|zoho|dynamics\s+365|freshsales)\b/i],
  },
  {
    requirement: 'investing_marketing',
    patterns: [/\b(investono\s+in\s+marketing|budget\s+marketing|spendono\s+in\s+pubblicit\w*)\b/i],
  },
  {
    requirement: 'google_ads_started',
    patterns: [/\bgoogle\s+ads\b/i, /\bcampagne\s+google\b/i],
  },
  {
    requirement: 'meta_ads_started',
    patterns: [/\bmeta\s+ads\b/i, /\b(facebook\s+ads|instagram\s+ads)\b/i],
  },
  {
    requirement: 'site_stale',
    patterns: [
      /\b(sito\s+lento|sito\s+datato|sito\s+vecchio|sito\s+non\s+aggiornato|web\s+obsolet\w*|copyright\s+datato)\b/i,
      /\b(caricamento\s+lento|performance\s+sito)\b/i,
    ],
  },
]

export const HIRING_ROLE_PATTERNS = [
  { role: 'programmatore', patterns: [/\b(programmator\w*|developer|sviluppat\w*|software|full[\s-]?stack|backend|frontend)\b/i] },
  { role: 'commerciale', patterns: [/\b(commercial\w*|venditor\w*|sales|account\s+manager|business\s+developer)\b/i] },
  { role: 'marketing', patterns: [/\b(marketing|social\s+media|seo|copywriter|growth)\b/i] },
  { role: 'tecnico', patterns: [/\b(tecnico|tecnici|installator\w*|manutentor\w*|operai|murator\w*)\b/i] },
  { role: 'hr', patterns: [/\b(risorse\s+umane|hr|recruiter|talent)\b/i] },
]

export const SECTOR_KEYWORD_EXTRACTORS = [
  { keyword: 'fotovoltaico', patterns: [/\bfotovoltaic|\bpannelli\s+solari|\bimpianti\s+solari|\benergia\s+solare|\bimpianti\s+fotovoltaic/i] },
  { keyword: 'edilizia', patterns: [/\bedil|\bcostruzion|\bristrutturaz|\bimpresa\s+edil/i] },
  { keyword: 'logistica', patterns: [/\blogistic|\btrasport|\bspedizion/i] },
  { keyword: 'software', patterns: [/\bsoftware|\bsaas|\bcloud|\bdigital/i] },
  { keyword: 'turismo', patterns: [/\bturismo|\bhotel|\bristorazion/i] },
  { keyword: 'sanita', patterns: [/\bsanit|\bclinic|\bospedal|\bmedici/i] },
]

export const CRM_KEYWORD_EXTRACTORS = [
  { crm: 'hubspot', patterns: [/\bhubspot\b/i] },
  { crm: 'salesforce', patterns: [/\bsalesforce\b/i] },
  { crm: 'pipedrive', patterns: [/\bpipedrive\b/i] },
  { crm: 'zoho', patterns: [/\bzoho\b/i] },
  { crm: 'dynamics', patterns: [/\bdynamics\s*365\b/i] },
]

function unique(arr) {
  return [...new Set(arr)]
}

function extractTimeWindowDays(query) {
  const q = query.toLowerCase()
  if (/\b(ultim[oi]\s+)?30\s+giorni\b/.test(q)) return 30
  if (/\b(ultim[oi]\s+)?60\s+giorni\b/.test(q)) return 60
  if (/\b(ultim[oi]\s+)?90\s+giorni\b/.test(q)) return 90
  if (/\b(ultim[oa]\s+)?anno\b/.test(q)) return 365
  const mMonths = q.match(/\bultim[oi]\s+(\d{1,2})\s+mesi\b/)
  if (mMonths) return Math.min(730, parseInt(mMonths[1], 10) * 30)
  return null
}

export function parseSignalIntentHeuristic(userQuery) {
  const q = (userQuery || '').trim()
  if (!q) return emptyIntent()

  const required_signals = []
  for (const entry of NL_SIGNAL_PATTERNS) {
    if (entry.patterns.some((p) => p.test(q))) required_signals.push(entry.requirement)
  }

  const hiring_roles = []
  for (const entry of HIRING_ROLE_PATTERNS) {
    if (entry.patterns.some((p) => p.test(q))) hiring_roles.push(entry.role)
  }
  if (hiring_roles.length && !required_signals.includes('hiring')) required_signals.push('hiring')

  const sector_keywords = []
  for (const entry of SECTOR_KEYWORD_EXTRACTORS) {
    if (entry.patterns.some((p) => p.test(q))) sector_keywords.push(entry.keyword)
  }
  if (sector_keywords.length && !required_signals.includes('sector_investment')) {
    const investIntent = /\b(invest|investono|investimento|puntano\s+su|fotovoltaic|rinnovabil|impianti\s+solari)\b/i.test(q)
    const highIntentKw = sector_keywords.some((k) => ['fotovoltaico', 'software', 'logistica'].includes(k))
    if (investIntent || highIntentKw) required_signals.push('sector_investment')
  }

  const crm_keywords = []
  for (const entry of CRM_KEYWORD_EXTRACTORS) {
    if (entry.patterns.some((p) => p.test(q))) crm_keywords.push(entry.crm)
  }

  const require_crm_change =
    (/\b(cambiat\w*|migrat\w*|nuovo\s+crm|switch|sostituit\w*)\b/i.test(q) &&
      (/\bcrm\b/i.test(q) || crm_keywords.length > 0)) ||
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

  let time_window_days = extractTimeWindowDays(q)
  if (required_signals.includes('tender_won') && !time_window_days) time_window_days = 365
  if (require_crm_change && !time_window_days) time_window_days = 30

  if (/\b(funding|fondi|finanziamento|round|investimento)\b/i.test(q) && /\bstartup\b/i.test(q)) {
    if (!required_signals.includes('sector_investment')) required_signals.push('sector_investment')
  }

  return {
    required_signals: unique(required_signals),
    hiring_roles: unique(hiring_roles),
    sector_keywords: unique(sector_keywords),
    crm_keywords: unique(crm_keywords),
    require_crm_change,
    time_window_days,
  }
}

export function emptyIntent() {
  return {
    required_signals: [],
    hiring_roles: [],
    sector_keywords: [],
    crm_keywords: [],
    require_crm_change: false,
    time_window_days: null,
  }
}

export function assertIntentCase(spec, c, fail, ok) {
  let okCase = true
  if (c.mustInclude && !c.mustInclude.every((x) => spec.required_signals.includes(x))) {
    fail(c.id, `atteso [${c.mustInclude}] got [${spec.required_signals}]`)
    okCase = false
  }
  if (c.mustExclude && c.mustExclude.some((x) => spec.required_signals.includes(x))) {
    fail(c.id, `falsi positivi [${c.mustExclude.filter((x) => spec.required_signals.includes(x))}]`)
    okCase = false
  }
  for (const r of c.hiring_roles || []) {
    if (!spec.hiring_roles.includes(r)) {
      fail(c.id, `role '${r}' mancante`)
      okCase = false
    }
  }
  for (const k of c.sector_keywords || []) {
    if (!spec.sector_keywords.includes(k)) {
      fail(c.id, `sector '${k}' mancante`)
      okCase = false
    }
  }
  for (const k of c.crm_keywords || []) {
    if (!spec.crm_keywords.includes(k)) {
      fail(c.id, `crm '${k}' mancante`)
      okCase = false
    }
  }
  if (c.time_window_days !== undefined && spec.time_window_days !== c.time_window_days) {
    fail(c.id, `time_window atteso ${c.time_window_days} got ${spec.time_window_days}`)
    okCase = false
  }
  if (c.require_crm_change !== undefined && spec.require_crm_change !== c.require_crm_change) {
    fail(c.id, `require_crm_change atteso ${c.require_crm_change}`)
    okCase = false
  }
  if (c.signalsExact && JSON.stringify(spec.required_signals.sort()) !== JSON.stringify([...c.signalsExact].sort())) {
    fail(c.id, `signalsExact atteso [${c.signalsExact}] got [${spec.required_signals}]`)
    okCase = false
  }
  return okCase
}

/** Mirror infer-maps-category.ts for Node tests */
export function inferMapsCategoryFromIntent(query, intent) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return intent.category ?? null

  const explicit = [
    [/\bagenzie?\s+(di\s+)?viagg\w*\b/i, 'Agenzie di viaggio'],
    [/\bristorant\w*\b/i, 'Ristoranti'],
    [/\b(software\s+house|web\s+agency)\b/i, 'Software house'],
    [/\bstartup\b/i, 'Startup'],
    [/\bimprese?\s+edil\w*\b/i, 'Imprese edili'],
  ]
  for (const [re, label] of explicit) {
    if (re.test(q)) return label
  }

  const roles = new Set((intent.hiring_roles || []).map((r) => r.toLowerCase()))

  if (
    roles.has('programmatore') ||
    /\b(python|javascript|developer|sviluppat\w*|software|full[\s-]?stack|backend)\b/i.test(q)
  ) {
    return 'Servizi informatici'
  }

  if (intent.required_signals?.includes('hiring')) return null

  if (
    intent.required_signals?.includes('sector_investment') &&
    /\b(startup|scaleup|fondi|funding|finanziamento|round)\b/i.test(q)
  ) {
    return 'Startup'
  }

  return intent.category ?? null
}
