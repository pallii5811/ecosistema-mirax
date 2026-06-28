/**
 * Test Fase 4-A — deliverability DNS helpers (standalone)
 * Run: node scripts/test-deliverability.mjs
 */

import assert from 'node:assert/strict'

function analyzeSpf(records) {
  const spf = records.find((r) => r.toLowerCase().startsWith('v=spf1'))
  if (!spf) return { status: 'missing' }
  if (spf.includes('+all')) return { status: 'warning' }
  return { status: 'ok' }
}

function scoreReport(spf, dmarc, dkimOk) {
  let score = 0
  if (spf.status === 'ok') score += 40
  if (dmarc.status === 'ok') score += 35
  if (dkimOk) score += 25
  return score
}

assert.equal(analyzeSpf([]).status, 'missing')
assert.equal(analyzeSpf(['v=spf1 include:_spf.google.com ~all']).status, 'ok')
assert.equal(analyzeSpf(['v=spf1 +all']).status, 'warning')

const score = scoreReport({ status: 'ok' }, { status: 'ok' }, true)
assert.equal(score, 100)

console.log('[test-deliverability] OK')
