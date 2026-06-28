/**
 * Blocco 8 — unit tests: orchestrator outreach dispatch
 */
import assert from 'node:assert/strict'
import { runAgent } from '../src/lib/agents/orchestrator.ts'

const block = await runAgent('outreach', { channel: 'invalid', dailySentCount: 0 })
assert.equal(block.status, 'error')

const ok = await runAgent('outreach', { channel: 'whatsapp', dailySentCount: 1, daysSinceLastContact: 20 })
assert.equal(ok.status, 'success')
assert.equal(ok.data?.allowed, true)

console.log('[test-block8-orchestrator] OK')
