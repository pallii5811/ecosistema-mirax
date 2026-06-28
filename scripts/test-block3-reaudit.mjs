/**
 * Blocco 3 — unit tests: re-audit selection + change detection
 */
import assert from 'node:assert/strict'
import { computeFreshnessScore } from '../src/lib/lead-object.ts'
import { detectLeadChanges } from '../src/lib/events/detect-changes.ts'

const REAUDIT_FRESHNESS_THRESHOLD = 40
const now = '2026-06-24T12:00:00.000Z'
const staleIso = '2026-05-01T12:00:00.000Z'

function leadFreshnessScore(lead) {
  if (typeof lead.freshness_score === 'number' && Number.isFinite(lead.freshness_score)) {
    return Math.round(lead.freshness_score)
  }
  return computeFreshnessScore(lead.last_audited_at)
}

function leadNeedsReaudit(lead, threshold = REAUDIT_FRESHNESS_THRESHOLD) {
  const last = lead.last_audited_at
  const freshness = leadFreshnessScore(lead)
  if (freshness > threshold && last) return false
  const site = String(lead.sito ?? lead.website ?? '').trim()
  const blank = new Set(['', 'n/d', 'n/a', 'n.d.', 'none', 'null', '-'])
  return site && !blank.has(site.toLowerCase())
}

assert.equal(REAUDIT_FRESHNESS_THRESHOLD, 40)

const freshLead = { sito: 'https://acme.it', last_audited_at: now, freshness_score: 95 }
assert.equal(leadNeedsReaudit(freshLead), false)

const staleLead = { sito: 'https://acme.it', last_audited_at: staleIso, freshness_score: 10 }
assert.equal(leadNeedsReaudit(staleLead), true)

const changes = detectLeadChanges(
  { meta_pixel: false, sito: 'https://x.it' },
  { meta_pixel: true, sito: 'https://x.it' },
  now,
)
assert.equal(changes.length, 1)
assert.equal(changes[0].field, 'meta_pixel')

assert.ok(computeFreshnessScore(staleIso) < 50)

console.log('[test-block3-reaudit] OK')
