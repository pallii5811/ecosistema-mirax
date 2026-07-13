import assert from 'node:assert/strict'
import { MIRAX_RELEASE_ID } from '../src/app/api/ops/release/route'

assert.match(MIRAX_RELEASE_ID, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/)
assert.equal(MIRAX_RELEASE_ID, '2026-07-13-complete-signal-lane-coverage-v5-11')
console.log('Release marker: 2/2 OK')
