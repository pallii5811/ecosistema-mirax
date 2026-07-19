import assert from 'node:assert/strict'
import { MIRAX_RELEASE_ID } from '../src/app/api/ops/release/route'

/** Accept current/legacy staging markers without weakening SHA/release identity checks. */
const ACCEPTED_RELEASE_MARKERS = new Set([
  '20260717_stage1_schema_insert_fallback',
  '20260719_114339',
  '2026-07-13-complete-signal-lane-coverage-v5-11',
])

assert.ok(
  ACCEPTED_RELEASE_MARKERS.has(MIRAX_RELEASE_ID) ||
    /^\d{8}_\d{6}$/.test(MIRAX_RELEASE_ID) ||
    /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(MIRAX_RELEASE_ID) ||
    /^\d{8}_[a-z0-9_]+$/.test(MIRAX_RELEASE_ID),
  `Unexpected MIRAX_RELEASE_ID format: ${MIRAX_RELEASE_ID}`,
)
assert.ok(
  ACCEPTED_RELEASE_MARKERS.has(MIRAX_RELEASE_ID),
  `MIRAX_RELEASE_ID ${MIRAX_RELEASE_ID} is not in the accepted release marker set`,
)
console.log(`Release marker: OK (${MIRAX_RELEASE_ID})`)
