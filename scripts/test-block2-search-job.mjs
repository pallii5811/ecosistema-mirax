/**
 * Blocco 2 — unit tests: search job payload + zone encoding
 */
import assert from 'node:assert/strict'
import { buildPendingSearchInsert, clampSearchMaxLeads, encodeMaxLeadsZone } from '../src/lib/search-job-payload.ts'

assert.equal(encodeMaxLeadsZone(10), '10')
assert.equal(encodeMaxLeadsZone(999), '999')
assert.equal(encodeMaxLeadsZone(10000), '10000')
assert.equal(encodeMaxLeadsZone(12000), '10000')
assert.equal(encodeMaxLeadsZone(0), undefined)
assert.equal(clampSearchMaxLeads(4679, 4679), 4679)
assert.equal(clampSearchMaxLeads(5000, 4679), 4679)
assert.equal(clampSearchMaxLeads(10000, 12000), 10000)

const row = buildPendingSearchInsert({
  category: 'Idraulici',
  location: 'Verona',
  userId: 'user-1',
  maxLeads: 25,
})
assert.equal(row.status, 'pending')
assert.equal(row.zone, '25')
assert.equal(row.category, 'Idraulici')
assert.deepEqual(row.results, [])

console.log('[test-block2-search-job] OK')
