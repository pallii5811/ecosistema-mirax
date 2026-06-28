/**
 * Blocco 2 — unit tests: Lead Object v2 + freshness
 */
import assert from 'node:assert/strict'
import {
  LEAD_OBJECT_VERSION,
  computeFreshnessScore,
  freshnessLabel,
  normalizeLeadObject,
} from '../src/lib/lead-object.ts'

const now = Date.parse('2026-06-24T12:00:00.000Z')

assert.equal(LEAD_OBJECT_VERSION, 2)

assert.equal(computeFreshnessScore(null, now), 0)
assert.equal(computeFreshnessScore('2026-06-24T12:00:00.000Z', now), 100)
assert.equal(computeFreshnessScore('2026-05-25T12:00:00.000Z', now), 0)
assert.ok(computeFreshnessScore('2026-06-09T12:00:00.000Z', now) >= 48)

assert.equal(freshnessLabel(90), 'Fresco')
assert.equal(freshnessLabel(0), 'Non auditato')

const raw = {
  business_name: ' Acme Srl ',
  phone: '+39 333 1234567',
  website: 'https://acme.it',
  tech_stack: ['WORDPRESS'],
  meta_pixel: false,
}
const lead = normalizeLeadObject(raw)
assert.equal(lead.lead_object_version, 2)
assert.equal(lead.azienda, 'Acme Srl')
assert.equal(lead.telefono, '+39 333 1234567')
assert.equal(lead.sito, 'https://acme.it')
assert.ok(lead.tech_stack.includes('WORDPRESS'))
assert.equal(lead.instagram_missing, true)

console.log('[test-block2-lead-object] OK')
