#!/usr/bin/env node
/**
 * Fase 8 — universe event stream helpers (no Supabase).
 */
import assert from 'node:assert/strict'
import {
  prependUniverseEvent,
  formatUniverseEventHeadline,
} from '../src/lib/realtime/universe-event-stream.ts'

const ev = {
  id: 'e1',
  event_type: 'website_changed',
  payload: { summary: 'Homepage aggiornata' },
  occurred_at: new Date().toISOString(),
  source: 'test',
}

assert.equal(formatUniverseEventHeadline(ev), 'Homepage aggiornata')
console.log('✓ formatUniverseEventHeadline')

const list = prependUniverseEvent([], ev)
assert.equal(list.length, 1)
const dup = prependUniverseEvent(list, ev)
assert.equal(dup.length, 1)
const next = prependUniverseEvent(list, { ...ev, id: 'e2' }, 2)
assert.equal(next.length, 2)
assert.equal(next[0].id, 'e2')
console.log('✓ prependUniverseEvent')

console.log('\n[test-universe-event-stream] OK')
