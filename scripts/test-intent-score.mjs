#!/usr/bin/env node
/**
 * Fase 7 — Intent Score tests (formula manifesto v3.0)
 */
import {
  calculateIntentScore,
  computeSignalStrength,
  buildIntentScoreBreakdown,
} from '../src/lib/scoring/intent-score-core.ts'

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log(`✓ ${label}`)
}
function fail(label, detail) {
  failed += 1
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('═══ Intent Score (Fase 7) ═══\n')

const empty = calculateIntentScore([])
if (empty === 0) ok('lead senza segnali → score 0')
else fail('empty score', String(empty))

const hiringCrm = calculateIntentScore([
  { signalType: 'hiring', confidence: 80, source_tier: 'official' },
  { signalType: 'crm_change', confidence: 85, source_tier: 'official' },
])
if (hiringCrm >= 60) ok(`hiring+crm_change → ${hiringCrm} (≥60)`)
else fail('hiring+crm', String(hiringCrm))

const tenderOnly = calculateIntentScore([{ signalType: 'tender_won', confidence: 90, source_tier: 'aggregator' }])
if (tenderOnly >= 15 && tenderOnly <= 25) ok(`solo tender → ${tenderOnly}`)
else fail('tender only', String(tenderOnly))

const strength = computeSignalStrength({ confidence: 100, freshness_hours: 0, source_tier: 'official' })
if (strength === 100) ok('signal_strength official fresh = 100')
else fail('strength', String(strength))

const workerLike = buildIntentScoreBreakdown([
  { type: 'hiring', confidence: 85, source_tier: 'official' },
  { type: 'crm_change', confidence: 80, source_tier: 'official' },
])
if (workerLike.score >= 60) ok(`worker signal types → ${workerLike.score}`)
else fail('worker types', String(workerLike.score))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
