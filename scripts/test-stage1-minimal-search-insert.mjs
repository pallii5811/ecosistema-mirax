import assert from 'node:assert/strict'
import {
  buildPendingSearchInsert,
  isMissingSearchesColumnError,
  toMinimalPendingSearchInsert,
} from '../src/lib/search-job-payload.ts'

const rich = buildPendingSearchInsert({
  category: 'ristoranti',
  location: 'Benevento',
  userId: 'u1',
  maxLeads: 25,
  intent: { original_query: 'ristoranti Benevento' },
})
assert.ok(rich.intent)
assert.ok(rich.zone)

const minimal = toMinimalPendingSearchInsert(rich)
assert.equal(minimal.category, 'ristoranti')
assert.equal(minimal.location, 'Benevento')
assert.equal(minimal.user_id, 'u1')
assert.equal(minimal.intent, undefined)
assert.equal(minimal.zone, undefined)

assert.equal(
  isMissingSearchesColumnError("Could not find the 'intent' column of 'searches' in the schema cache"),
  true,
)
assert.equal(isMissingSearchesColumnError('unrelated'), false)

console.log('stage1-minimal-search-insert: ok')
