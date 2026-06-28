#!/usr/bin/env node
/**
 * Fase 10 — competitive intelligence + market map metrics
 */
import {
  computeDigitalMaturityFromLead,
  computeGrowthRateFromSignals,
  filterMarketPoints,
  intentScoreToColor,
  leadToMarketPoint,
  parseEstimatedRevenue,
  pickStrongCompetitorSignals,
  buildCompetitorAlertCopy,
  revenueToRadius,
} from '../src/lib/competitive/market-metrics-core.ts'

let passed = 0
let failed = 0
function ok(l) {
  passed++
  console.log(`✓ ${l}`)
}
function fail(l, d) {
  failed++
  console.error(`✗ ${l}${d ? ` — ${d}` : ''}`)
}

console.log('═══ Competitive Intelligence (Fase 10) ═══\n')

const mature = computeDigitalMaturityFromLead({
  has_google_ads: true,
  detected_crm_stack: ['HubSpot'],
  tech_stack: ['react', 'ga4', 'hubspot', 'cloudflare'],
  website: 'https://acme.it',
})
if (mature >= 60) ok(`digital maturity con stack (${mature})`)
else fail('digital maturity', String(mature))

const growth = computeGrowthRateFromSignals([
  { type: 'hiring', title: 'Assunzioni' },
  { type: 'tender_won', title: 'Gara vinta' },
])
if (growth >= 70) ok(`growth rate hiring+tender (${growth})`)
else fail('growth rate', String(growth))

const rev = parseEstimatedRevenue({ fatturato: 1_200_000 })
if (rev === 1_200_000) ok('parse fatturato OpenAPI')
else fail('revenue', String(rev))

const pt = leadToMarketPoint(
  {
    azienda: 'Beta Srl',
    citta: 'Verona',
    categoria: 'edile',
    business_signals: [{ type: 'hiring', title: 'Muratori' }],
    fatturato: 800_000,
  },
  'lead-1',
  'lead',
)
if (pt.name === 'Beta Srl' && pt.city === 'Verona') ok('leadToMarketPoint')
else fail('leadToMarketPoint')

const filtered = filterMarketPoints(
  [pt, { ...pt, id: 'x', city: 'Roma', intentScore: 50 }],
  { city: 'verona', minIntent: 0 },
)
if (filtered.length === 1 && filtered[0].id === 'lead-1') ok('filter city')
else fail('filter', String(filtered.length))

const strong = pickStrongCompetitorSignals([
  { type: 'tender_won', title: 'Gara €500k', signal_strength: 85 },
])
if (strong[0]?.type === 'tender_won') ok('strong signal tender_won')
else fail('strong signals')

const alert = buildCompetitorAlertCopy('Rival SpA', strong[0], 'Milano')
if (alert.title.includes('Rival SpA') && alert.title.includes('gara')) ok('alert copy gara')
else fail('alert copy')

const colorLow = intentScoreToColor(10)
const colorHigh = intentScoreToColor(90)
if (colorLow !== colorHigh) ok('intent color gradient')
else fail('intent colors')

const rSmall = revenueToRadius(100_000, 100_000, 2_000_000)
const rBig = revenueToRadius(2_000_000, 100_000, 2_000_000)
if (rBig > rSmall) ok('bubble radius by revenue')
else fail('bubble radius')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
