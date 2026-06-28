#!/usr/bin/env node
/**
 * Fase 9 — outbound sequences + copywriter prompt tests
 */
import {
  OUTBOUND_SEQUENCES,
  matchOutboundSequence,
  collectSignalTypesFromLead,
} from '../src/lib/outbound/sequences.ts'
import { buildOutboundCopyPrompt, parseCopywriterResponse } from '../src/lib/outbound/ai-copywriter.ts'

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

console.log('═══ Outbound Automation (Fase 9) ═══\n')

if (Object.keys(OUTBOUND_SEQUENCES).length >= 3) ok('3 sequenze definite')
else fail('sequences count')

const hiring = matchOutboundSequence({ signalTypes: ['hiring'], intentScore: 55 })
if (hiring?.key === 'hiring_play') ok('hiring → hiring_play')
else fail('hiring match', hiring?.key)

const tender = matchOutboundSequence({ signalTypes: ['tender_won'], intentScore: 65 })
if (tender?.key === 'tender_play') ok('tender_won → tender_play')
else fail('tender match', tender?.key)

const hot = matchOutboundSequence({ signalTypes: ['hiring'], intentScore: 85 })
if (hot?.key === 'hot_lead_play') ok('intent 85 → hot_lead_play')
else fail('hot match', hot?.key)

const none = matchOutboundSequence({ signalTypes: [], intentScore: 10 })
if (!none) ok('no signal → null')
else fail('should be null')

const types = collectSignalTypesFromLead({
  business_signals: [{ type: 'hiring', title: 'Assunzioni' }],
})
if (types.includes('hiring')) ok('collectSignalTypesFromLead')

const prompt = buildOutboundCopyPrompt({
  companyName: 'Acme Srl',
  signals: [{ type: 'hiring', title: 'Assunzioni dev' }],
})
if (prompt.includes('Acme Srl') && prompt.includes('hiring')) ok('copywriter prompt')

const variants = parseCopywriterResponse(
  JSON.stringify({
    variants: [
      { label: 'A', subject: 'Oggetto A', body: 'Corpo A' },
      { label: 'B', subject: 'Oggetto B', body: 'Corpo B' },
      { label: 'C', subject: 'Oggetto C', body: 'Corpo C' },
    ],
  }),
)
if (variants.length === 3) ok('parse 3 varianti AI')
else fail('variants', String(variants.length))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
