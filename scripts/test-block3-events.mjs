/**
 * Blocco 3 — unit tests: event types
 */
import assert from 'node:assert/strict'
import { MIRAX_EVENT_TYPES, isMiraxEventType } from '../src/lib/events/types.ts'

assert.ok(MIRAX_EVENT_TYPES.includes('lead.change_detected'))
assert.ok(isMiraxEventType('outreach.sent'))
assert.equal(isMiraxEventType('invalid.event'), false)

console.log('[test-block3-events] OK')
