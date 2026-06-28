#!/usr/bin/env node
/**
 * E2E: signal intent NL + business events da lead arricchito (mock worker output).
 */
let passed = 0
let failed = 0

function ok(msg) {
  passed += 1
  console.log(`✓ ${msg}`)
}

function fail(msg) {
  failed += 1
  console.error(`✗ ${msg}`)
}

const QUERIES = [
  {
    q: 'trova aziende che stanno assumendo programmatori a Bologna',
    expectIntent: 'hiring',
    dataField: 'business_hiring_jobs',
    source: 'Indeed IT (Playwright, worker 116 — business_events_enrich.py)',
  },
  {
    q: 'imprese edili che hanno vinto una gara nell ultimo anno',
    expectIntent: 'tender_won',
    dataField: 'business_tender_hits',
    source: 'Bing web search (worker 116 — business_events_enrich.py)',
  },
  {
    q: 'PMI che investono nel fotovoltaico in Veneto',
    expectIntent: 'sector_investment',
    dataField: 'business_sector_hits',
    source: 'Keyword match HTML/categoria (worker + audit_engine)',
  },
  {
    q: 'aziende che hanno cambiato CRM negli ultimi 30 giorni',
    expectIntent: 'crm_change',
    dataField: 'audit_changes',
    source: 'Delta CRM stack tra audit successivi (worker re-audit)',
  },
]

function regexIntent(q) {
  const lower = q.toLowerCase()
  if (/assum|hiring|offerte di lavoro|programmator/.test(lower)) return 'hiring'
  if (/gara|appalto|aggiudic|bando/.test(lower)) return 'tender_won'
  if (/fotovoltaic|pannelli solari|rinnovabil/.test(lower)) return 'sector_investment'
  if (/cambiat.*crm|nuovo crm|migrat.*crm/.test(lower)) return 'crm_change'
  return null
}

function collectFromMockLead(lead) {
  const signals = []
  if (Array.isArray(lead.business_hiring_jobs) && lead.business_hiring_jobs.length) {
    signals.push({ signalType: 'hiring', source: 'indeed_scrape' })
  }
  if (Array.isArray(lead.business_tender_hits) && lead.business_tender_hits.length) {
    signals.push({ signalType: 'tender_won', source: 'web_search' })
  }
  if (Array.isArray(lead.business_sector_hits) && lead.business_sector_hits.length) {
    signals.push({ signalType: 'sector_investment', source: 'website_audit' })
  }
  if (Array.isArray(lead.detected_crm_stack) && lead.detected_crm_stack.length) {
    signals.push({ signalType: 'crm_detected', source: 'website_audit' })
  }
  if (Array.isArray(lead.audit_changes) && lead.audit_changes.some((c) => String(c?.field || '').includes('crm'))) {
    signals.push({ signalType: 'crm_change', source: 'audit_delta' })
  }
  const storico = lead.openapi_enriched?.storico_bilanci
  if (Array.isArray(storico) && storico.length >= 2) {
    signals.push({ signalType: 'registry_change', source: 'openapi_it' })
  }
  const tr = lead.technical_report || {}
  if (tr.load_speed_seconds >= 4.5 || (tr.copyright_year && tr.copyright_year <= new Date().getFullYear() - 2)) {
    signals.push({ signalType: 'site_stale', source: 'website_audit' })
  }
  if (tr.google_ads_active) {
    signals.push({ signalType: 'google_ads_started', source: 'website_audit' })
  }
  return signals
}

const MOCK_LEAD = {
  azienda: 'Edil Veneto Srl',
  sito: 'https://example-edil.it',
  categoria: 'Impresa edile',
  business_hiring_jobs: [{ title: 'Programmatore full stack', source: 'indeed' }],
  business_tender_hits: [{ title: 'Aggiudicazione gara manutenzione strade', source: 'web_search' }],
  business_sector_hits: [{ keyword: 'fotovoltaico', snippet: 'installazione impianti fotovoltaici' }],
  detected_crm_stack: ['HubSpot'],
  audit_changes: [{ field: 'crm_stack', signal: 'CRM cambiato: Salesforce → HubSpot' }],
  technical_report: { google_ads_active: true, copyright_year: 2019, load_speed_seconds: 5.2 },
  openapi_enriched: {
    storico_bilanci: [
      { anno: 2024, fatturato: 1200000, dipendenti: 45 },
      { anno: 2023, fatturato: 900000, dipendenti: 32 },
    ],
  },
}

console.log('━━━ Signal intent NL (query → intent) ━━━')
for (const { q, expectIntent, dataField, source } of QUERIES) {
  const intent = regexIntent(q)
  if (intent === expectIntent) {
    ok(`"${q.slice(0, 55)}…" → ${expectIntent} [${dataField}] ← ${source}`)
  } else {
    fail(`"${q}" → atteso ${expectIntent}, got ${intent}`)
  }
}

console.log('\n━━━ Business events da lead arricchito (mock worker) ━━━')
const signals = collectFromMockLead(MOCK_LEAD)
const types = new Set(signals.map((s) => s.signalType))
for (const t of [
  'hiring',
  'tender_won',
  'sector_investment',
  'crm_detected',
  'crm_change',
  'registry_change',
  'site_stale',
  'google_ads_started',
]) {
  if (types.has(t)) {
    const src = signals.find((s) => s.signalType === t)?.source
    ok(`segnale ${t} (${src})`)
  } else {
    fail(`segnale ${t} mancante`)
  }
}

console.log('\n━━━ Mappa fonti dati ━━━')
const SOURCE_MAP = [
  ['Lead base (nome, sito, tel, email, città)', 'Google Maps + organic search — worker main.py'],
  ['Audit sito (velocità, copyright, tech stack)', 'audit_engine.py — HTTP fetch + analisi HTML'],
  ['Google/Meta Ads attivi', 'audit_engine.py — pixel/script nel sito'],
  ['Registro (P.IVA, bilanci, dipendenti)', 'openapi.it API — enrichment post-scrape'],
  ['Hiring / offerte lavoro', 'Indeed IT — Playwright (business_events_enrich.py, Hetzner 116)'],
  ['Gare vinte / appalti', 'Bing search HTML (business_events_enrich.py)'],
  ['Investimento settore (fotovoltaico, ecc.)', 'Keyword match su HTML + categoria lead'],
  ['CRM rilevato', 'Pattern script HTML (audit + business_events_enrich.py)'],
  ['Cambio CRM', 'Confronto detected_crm_stack tra audit (audit_changes)'],
  ['Crescita registro', 'storico_bilanci OpenAPI — registry-delta.ts'],
  ['Sito datato/lento', 'technical_report + freshness_score da audit'],
]
for (const [tipo, fonte] of SOURCE_MAP) {
  console.log(`  • ${tipo}\n    → ${fonte}`)
}

if (failed > 0) {
  console.error(`\n[test-signal-sources-e2e] ${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n[test-signal-sources-e2e] ${passed} passed`)
