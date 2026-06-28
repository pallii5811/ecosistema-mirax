#!/usr/bin/env node
/**
 * Fase 5.1 — verifica SIGNAL_REGISTRY TypeScript
 */
import {
  SIGNAL_REGISTRY,
  SIGNAL_REGISTRY_KEYS,
  getSignalConfig,
  getSourcesForSignal,
  orderedWaterfallSources,
} from '../src/lib/signals/registry.ts'

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

console.log('═══ Waterfall Signal Registry (Fase 5.1) ═══\n')

if (SIGNAL_REGISTRY_KEYS.length >= 8) {
  ok(`${SIGNAL_REGISTRY_KEYS.length} tipi segnale nel registry (≥8)`)
} else {
  fail('registry size', `solo ${SIGNAL_REGISTRY_KEYS.length}`)
}

for (const key of ['hiring', 'tender_won', 'funding_received', 'executive_change', 'website_changed']) {
  const cfg = getSignalConfig(key)
  if (cfg && cfg.sources.length >= 1) ok(`${key} ha ${cfg.sources.length} fonti`)
  else fail(`${key} config`)
}

const hiringSources = getSourcesForSignal('hiring')
if (hiringSources[0]?.name === 'mirax_audit') ok('hiring: mirax_audit prima fonte')
else fail('hiring audit order', hiringSources[0]?.name)

const ordered = orderedWaterfallSources(['hiring', 'tender_won'])
const hFirst = ordered.get('hiring')?.[0]?.name
if (hFirst === 'mirax_audit') ok('orderedWaterfall: audit first')
else fail('orderedWaterfall audit', hFirst)

if (getSignalConfig('hiring')?.parallel === false) ok('hiring cascade (non parallel)')
if (getSignalConfig('funding_received')?.parallel === true) ok('funding parallel')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
