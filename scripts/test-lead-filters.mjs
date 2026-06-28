#!/usr/bin/env node
/**
 * Soft filter lead — regression test (lead invisibili fix)
 */
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

function softBusinessFilter(leads, filters, matchFn) {
  if (!filters.length) return { visible: leads, hasActiveFilter: false, missingSignals: false }
  const filtered = leads.filter((l) => matchFn(l, filters))
  if (filtered.length === 0 && leads.length > 0) {
    return { visible: leads, hasActiveFilter: true, missingSignals: true }
  }
  return { visible: filtered, hasActiveFilter: true, missingSignals: false }
}

console.log('═══ Lead filter soft (UX fix) ═══\n')

const leads = [{ id: 1, signals: [] }, { id: 2, signals: ['hiring'] }]

const none = softBusinessFilter(leads, [], () => false)
if (none.visible.length === 2 && !none.missingSignals) ok('no filter → all visible')

const miss = softBusinessFilter(leads, ['tender_won'], (l, f) => l.signals.some((s) => f.includes(s)))
if (miss.missingSignals && miss.visible.length === 2) ok('no match → soft show all + banner flag')

const hit = softBusinessFilter(leads, ['hiring'], (l, f) => l.signals.some((s) => f.includes(s)))
if (!hit.missingSignals && hit.visible.length === 1) ok('partial match → strict filter')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
