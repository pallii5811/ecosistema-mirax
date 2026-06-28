#!/usr/bin/env node
/**
 * 25 query utente reale — parser + filter (logica speculare a catalog.ts + parse-heuristic.ts + match-lead.ts)
 * Run: node scripts/test-20-real-user-queries.mjs
 */
import assert from 'node:assert/strict'

// ── catalog.ts (mirror) ─────────────────────────────────────────────────────
const NL_SIGNAL_PATTERNS = [
  {
    requirement: 'hiring',
    patterns: [
      /\b(assum|assunz|assumendo|assunzioni|assumono|offerte?\s+di\s+lavoro|job\s+open|recruit|hiring|personale)\b/i,
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
      /\b(gara|appalto|aggiudicat|aggiudicaz|vincit|bando\s+pubblic|lavori\s+pubblici|pubblica\s+amministrazione|anac|mepa)\b/i,
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
    patterns: [/\b(investono\s+in\s+marketing|budget\s+marketing|spendono\s+in\s+pubblicit)\b/i],
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
      /\b(sito\s+lento|sito\s+datato|sito\s+vecchio|sito\s+non\s+aggiornato|web\s+obsolet|copyright\s+datato)\b/i,
      /\b(caricamento\s+lento|performance\s+sito)\b/i,
    ],
  },
]

const HIRING_ROLE_PATTERNS = [
  { role: 'programmatore', patterns: [/\b(programmator\w*|developer|sviluppat\w*|software|full[\s-]?stack|backend|frontend)\b/i] },
  { role: 'commerciale', patterns: [/\b(commercial\w*|venditor\w*|sales|account\s+manager|business\s+developer)\b/i] },
  { role: 'marketing', patterns: [/\b(marketing|social\s+media|seo|copywriter|growth)\b/i] },
  { role: 'tecnico', patterns: [/\b(tecnico|tecnici|installator|installatori|manutentor|operai|murator)\b/i] },
  { role: 'hr', patterns: [/\b(risorse\s+umane|hr|recruiter|talent)\b/i] },
]

const SECTOR_KEYWORD_EXTRACTORS = [
  { keyword: 'fotovoltaico', patterns: [/\bfotovoltaic|\bpannelli\s+solari|\bimpianti\s+solari|\benergia\s+solare|\bimpianti\s+fotovoltaic/i] },
  { keyword: 'edilizia', patterns: [/\bedil|\bcostruzion|\bristrutturaz|\bimpresa\s+edil/i] },
  { keyword: 'logistica', patterns: [/\blogistic|\btrasport|\bspedizion/i] },
  { keyword: 'software', patterns: [/\bsoftware|\bsaas|\bcloud|\bdigital/i] },
  { keyword: 'turismo', patterns: [/\bturismo|\bhotel|\bb\b|\bristorazion/i] },
  { keyword: 'sanita', patterns: [/\bsanit|\bclinic|\bospedal|\bmedici/i] },
]

const CRM_KEYWORD_EXTRACTORS = [
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

function parseSignalIntentHeuristic(userQuery) {
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
    /\b(cambiat\w*|migrat\w*|nuovo\s+crm|switch)\b/i.test(q) &&
    (/\bcrm\b/i.test(q) || crm_keywords.length > 0)

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

  return {
    required_signals: unique(required_signals),
    hiring_roles: unique(hiring_roles),
    sector_keywords: unique(sector_keywords),
    crm_keywords: unique(crm_keywords),
    require_crm_change,
    time_window_days,
  }
}

function emptyIntent() {
  return {
    required_signals: [],
    hiring_roles: [],
    sector_keywords: [],
    crm_keywords: [],
    require_crm_change: false,
    time_window_days: null,
  }
}

// ── simplified lead matchers (match-lead.ts logic) ────────────────────────────
function detectHiring(lead, roles) {
  const jobs = lead.business_hiring_jobs
  if (!Array.isArray(jobs) || !jobs.length) return false
  if (!roles.length) return true
  const hay = jobs.map((j) => String(j?.title || '')).join(' ').toLowerCase()
  return roles.some((r) => hay.includes(r.toLowerCase()))
}

function detectTender(lead) {
  return Array.isArray(lead.business_tender_hits) && lead.business_tender_hits.length > 0
}

function detectSector(lead, keywords) {
  if (Array.isArray(lead.business_sector_hits) && lead.business_sector_hits.length) return true
  const text = [lead.categoria, lead.category, JSON.stringify(lead.technical_report || '')].join(' ').toLowerCase()
  return keywords.some((k) => text.includes(k.toLowerCase()))
}

function detectCrmChange(lead, days) {
  const changes = lead.audit_changes
  if (!Array.isArray(changes)) return false
  const crm = changes.filter((c) => String(c?.field || '').includes('crm'))
  if (!crm.length) return false
  if (!days) return true
  const cutoff = Date.now() - days * 86400000
  return crm.some((c) => {
    const d = Date.parse(String(c.detected_at || ''))
    return Number.isFinite(d) && d >= cutoff
  })
}

function detectCrm(lead, keywords) {
  const stack = lead.detected_crm_stack
  if (!Array.isArray(stack) || !stack.length) return false
  if (!keywords.length) return true
  const hay = stack.join(' ').toLowerCase()
  return keywords.some((k) => hay.includes(k.toLowerCase()))
}

function detectRegistry(lead) {
  const s = lead.openapi_enriched?.storico_bilanci
  if (!Array.isArray(s) || s.length < 2) return false
  const [a, b] = s.sort((x, y) => (y.anno || 0) - (x.anno || 0))
  return (a.dipendenti > b.dipendenti) || (a.fatturato > b.fatturato)
}

function detectSiteStale(lead) {
  const tr = lead.technical_report || {}
  if (typeof tr.load_speed_seconds === 'number' && tr.load_speed_seconds >= 4.5) return true
  const y = tr.copyright_year
  return typeof y === 'number' && y <= new Date().getFullYear() - 2
}

function detectGoogleAds(lead) {
  return lead.google_ads === true || lead.technical_report?.has_google_ads === true
}

function detectMetaAds(lead) {
  return lead.meta_ads === true || lead.technical_report?.has_facebook_pixel === true
}

function leadMatchesIntent(lead, intent) {
  if (!intent.required_signals.length) return true
  for (const req of intent.required_signals) {
    switch (req) {
      case 'hiring':
        if (!detectHiring(lead, intent.hiring_roles)) return false
        break
      case 'tender_won':
        if (!detectTender(lead)) return false
        break
      case 'sector_investment':
        if (!detectSector(lead, intent.sector_keywords)) return false
        break
      case 'crm_change':
        if (!detectCrmChange(lead, intent.time_window_days)) return false
        break
      case 'crm_detected':
        if (!detectCrm(lead, intent.crm_keywords)) return false
        break
      case 'registry_change':
        if (!detectRegistry(lead)) return false
        break
      case 'site_stale':
        if (!detectSiteStale(lead)) return false
        break
      case 'google_ads_started':
        if (!detectGoogleAds(lead)) return false
        break
      case 'meta_ads_started':
        if (!detectMetaAds(lead)) return false
        break
      case 'investing_marketing':
        if (!detectGoogleAds(lead) && !detectMetaAds(lead)) return false
        break
      default:
        break
    }
  }
  return true
}

function filterLeads(leads, intent) {
  if (!intent.required_signals.length) return leads
  return leads.filter((l) => leadMatchesIntent(l, intent))
}

// ── 25 test cases ───────────────────────────────────────────────────────────
const CASES = [
  { id: 'Q01', query: 'trova aziende che stanno assumendo programmatori a Bologna', mustInclude: ['hiring'], hiring_roles: ['programmatore'] },
  { id: 'Q02', query: "imprese edili che hanno vinto una gara nell'ultimo anno", mustInclude: ['tender_won'], sector_keywords: ['edilizia'], time_window_days: 365 },
  { id: 'Q03', query: 'PMI che investono nel fotovoltaico in Veneto', mustInclude: ['sector_investment'], sector_keywords: ['fotovoltaico'] },
  { id: 'Q04', query: 'aziende che hanno cambiato CRM negli ultimi 30 giorni', mustInclude: ['crm_change'], time_window_days: 30, require_crm_change: true },
  { id: 'Q05', query: 'idraulici urgenti a Roma', mustExclude: ['hiring', 'sector_investment', 'tender_won', 'crm_change'] },
  { id: 'Q06', query: 'aziende con Google Ads attivo a Torino', mustInclude: ['google_ads_started'] },
  { id: 'Q07', query: 'chi usa HubSpot in Lombardia', mustInclude: ['crm_detected'], crm_keywords: ['hubspot'] },
  { id: 'Q08', query: 'startup con crescita fatturato in Emilia Romagna', mustInclude: ['registry_change'] },
  { id: 'Q09', query: 'imprese che assumono commerciali a Firenze', mustInclude: ['hiring'], hiring_roles: ['commerciale'] },
  { id: 'Q10', query: 'aziende logistica che puntano su automazione', mustInclude: ['sector_investment'], sector_keywords: ['logistica'] },
  { id: 'Q11', query: 'vincitori gara appalto manutenzione strade Veneto', mustInclude: ['tender_won'] },
  { id: 'Q12', query: 'chi ha migrato a Salesforce negli ultimi 60 giorni', mustInclude: ['crm_change'], crm_keywords: ['salesforce'], time_window_days: 60, require_crm_change: true },
  { id: 'Q13', query: 'ristoranti con sito lento a Napoli', mustInclude: ['site_stale'] },
  { id: 'Q14', query: 'imprese edili Modena', mustExclude: ['tender_won', 'hiring', 'crm_change', 'sector_investment'] },
  { id: 'Q15', query: 'PMI fotovoltaico Toscana assumendo tecnici installatori', mustInclude: ['hiring', 'sector_investment'], hiring_roles: ['tecnico'], sector_keywords: ['fotovoltaico'] },
  { id: 'Q16', query: 'aziende che investono in marketing digitale Milano', mustInclude: ['investing_marketing'] },
  { id: 'Q17', query: 'hotel con Meta Ads attive Costa Amalfitana', mustInclude: ['meta_ads_started'] },
  { id: 'Q18', query: 'camera di commercio crescita dipendenti Veneto', mustInclude: ['registry_change'], mustExclude: ['hiring'] },
  { id: 'Q19', query: 'bando pubblico aggiudicazione lavori pubblici Piemonte', mustInclude: ['tender_won'] },
  { id: 'Q20', query: 'software house assumono developer full remote', mustInclude: ['hiring'], hiring_roles: ['programmatore'] },
  { id: 'Q21', query: 'aziende con Zoho CRM in Toscana', mustInclude: ['crm_detected'], crm_keywords: ['zoho'] },
  { id: 'Q22', query: 'cliniche private assunzioni infermieri Lazio', mustInclude: ['hiring'] },
  { id: 'Q23', query: 'consulenti fiscali Torino centro', mustExclude: ['hiring', 'tender_won', 'sector_investment', 'crm_change'] },
  { id: 'Q24', query: 'aziende edili crescita organico dipendenti ultimi 12 mesi', mustInclude: ['registry_change'], mustExclude: ['tender_won', 'hiring'] },
  { id: 'Q25', query: 'impianti solari Lombardia vincitori appalto PA', mustInclude: ['tender_won', 'sector_investment'], sector_keywords: ['fotovoltaico'] },
]

const MOCK = {
  hiring_dev: { business_hiring_jobs: [{ title: 'Programmatore full stack' }] },
  hiring_sales: { business_hiring_jobs: [{ title: 'Commerciale B2B' }] },
  tender: { business_tender_hits: [{ title: 'Aggiudicazione gara' }] },
  fotovoltaico: { categoria: 'fotovoltaico', business_sector_hits: [{ keyword: 'fotovoltaico' }] },
  crm_change: { audit_changes: [{ field: 'crm_stack', detected_at: new Date().toISOString() }] },
  crm_hubspot: { detected_crm_stack: ['HubSpot'] },
  registry: { openapi_enriched: { storico_bilanci: [{ anno: 2024, dipendenti: 50, fatturato: 2e6 }, { anno: 2023, dipendenti: 35, fatturato: 1.5e6 }] } },
  site_slow: { technical_report: { load_speed_seconds: 6.2, copyright_year: 2018 } },
  google_ads: { google_ads: true, technical_report: { has_google_ads: true } },
  meta_ads: { meta_ads: true, technical_report: { has_facebook_pixel: true } },
  plain: { categoria: 'idraulico', telefono: '0511234567' },
}

const FILTER_CASES = [
  { label: 'Q01 hiring dev', query: CASES[0].query, match: ['hiring_dev'], reject: ['plain'] },
  { label: 'Q02 tender', query: CASES[1].query, match: ['tender'], reject: ['plain'] },
  { label: 'Q03 fotovoltaico', query: CASES[2].query, match: ['fotovoltaico'], reject: ['plain'] },
  { label: 'Q04 crm change', query: CASES[3].query, match: ['crm_change'], reject: ['crm_hubspot'] },
  { label: 'Q05 idraulici no filter', query: CASES[4].query, match: ['plain', 'hiring_dev'], reject: [] },
  { label: 'Q13 sito lento', query: CASES[12].query, match: ['site_slow'], reject: ['plain'] },
  { label: 'Q07 HubSpot', query: CASES[6].query, match: ['crm_hubspot'], reject: ['plain'] },
  { label: 'Q08 registry', query: CASES[7].query, match: ['registry'], reject: ['plain'] },
  { label: 'Q06 Google Ads', query: CASES[5].query, match: ['google_ads'], reject: ['plain'] },
  { label: 'Q17 Meta Ads', query: CASES[16].query, match: ['meta_ads'], reject: ['plain'] },
]

let passed = 0
let failed = 0
const accuracyIssues = []

function ok(m) { passed++; console.log(`  ✓ ${m}`) }
function fail(m, d) { failed++; accuracyIssues.push(`${m}: ${d}`); console.error(`  ✗ ${m} — ${d}`) }

console.log('══════════════════════════════════════════════════')
console.log('25 QUERY UTENTE REALE — Analisi accuratezza')
console.log('══════════════════════════════════════════════════\n')

console.log('━━━ A. Parser intent (25 query) ━━━\n')
for (const c of CASES) {
  const spec = parseSignalIntentHeuristic(c.query)
  let okCase = true
  if (c.mustInclude && !c.mustInclude.every((x) => spec.required_signals.includes(x))) {
    fail(c.id, `atteso [${c.mustInclude}] got [${spec.required_signals}] | "${c.query.slice(0, 55)}"`)
    okCase = false
  }
  if (c.mustExclude && c.mustExclude.some((x) => spec.required_signals.includes(x))) {
    const bad = c.mustExclude.filter((x) => spec.required_signals.includes(x))
    fail(c.id, `falsi positivi [${bad}] | "${c.query.slice(0, 55)}"`)
    okCase = false
  }
  for (const r of c.hiring_roles || []) {
    if (!spec.hiring_roles.includes(r)) { fail(c.id, `role '${r}' mancante`); okCase = false }
  }
  for (const k of c.sector_keywords || []) {
    if (!spec.sector_keywords.includes(k)) { fail(c.id, `sector '${k}' mancante`); okCase = false }
  }
  for (const k of c.crm_keywords || []) {
    if (!spec.crm_keywords.includes(k)) { fail(c.id, `crm '${k}' mancante`); okCase = false }
  }
  if (c.time_window_days !== undefined && spec.time_window_days !== c.time_window_days) {
    fail(c.id, `time_window atteso ${c.time_window_days} got ${spec.time_window_days}`); okCase = false
  }
  if (c.require_crm_change !== undefined && spec.require_crm_change !== c.require_crm_change) {
    fail(c.id, `require_crm_change atteso ${c.require_crm_change}`); okCase = false
  }
  if (okCase) ok(`${c.id} [${spec.required_signals.join(', ') || '—'}] "${c.query.slice(0, 50)}…"`)
}

console.log('\n━━━ B. Filter accuracy (10 scenari) ━━━\n')
for (const fc of FILTER_CASES) {
  const intent = parseSignalIntentHeuristic(fc.query)
  const entries = Object.entries(MOCK)
  const filtered = filterLeads(entries.map(([, v]) => v), intent)
  const keys = entries.filter(([, v]) => filtered.includes(v)).map(([k]) => k)
  let fcOk = true
  for (const k of fc.match) if (!keys.includes(k)) { fail(fc.label, `mancava ${k}, got [${keys}]`); fcOk = false }
  for (const k of fc.reject) if (keys.includes(k)) { fail(fc.label, `falso positivo ${k}`); fcOk = false }
  if (fcOk) ok(`${fc.label} → [${keys.join(', ')}]`)
}

// ── Gap analysis (known catalog gaps vs expected) ───────────────────────────
console.log('\n━━━ C. Gap analysis (accuratezza reale catalog.ts) ━━━\n')
const GAPS = [
  { q: 'ristoranti con sito lento a Napoli', gap: 'site_stale', inCatalog: NL_SIGNAL_PATTERNS.some((e) => e.requirement === 'site_stale') },
  { q: 'aziende con Google Ads attivo a Torino', gap: 'google_ads_started', inCatalog: NL_SIGNAL_PATTERNS.some((e) => e.requirement === 'google_ads_started') },
  { q: 'hotel con Meta Ads attive', gap: 'meta_ads_started', inCatalog: NL_SIGNAL_PATTERNS.some((e) => e.requirement === 'meta_ads_started') },
  { q: 'idraulici urgenti a Roma', gap: 'no false sector_investment', inCatalog: !parseSignalIntentHeuristic('idraulici urgenti a Roma').required_signals.includes('sector_investment') },
  { q: 'imprese edili Modena', gap: 'no false sector/tender', inCatalog: parseSignalIntentHeuristic('imprese edili Modena').required_signals.length === 0 || !parseSignalIntentHeuristic('imprese edili Modena').required_signals.includes('tender_won') },
]
for (const g of GAPS) {
  if (g.inCatalog) ok(`Gap OK: ${g.gap}`)
  else fail(`Gap catalogo`, `${g.gap} — query "${g.q}"`)
}

console.log('\n══════════════════════════════════════════════════')
const pct = Math.round((passed / (passed + failed)) * 100)
console.log(`Totale: ${passed} OK, ${failed} FAIL — accuratezza ${pct}%`)
if (accuracyIssues.length) {
  console.log('\n📋 Issue da correggere per 100%:')
  accuracyIssues.forEach((i) => console.log(`  • ${i}`))
}
console.log('')
process.exit(failed > 0 ? 1 : 0)
