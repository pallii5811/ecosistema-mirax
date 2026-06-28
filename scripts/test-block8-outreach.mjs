/**
 * Blocco 8 — unit tests: outreach guardrails
 */
import assert from 'node:assert/strict'
import { checkOutreachGuardrails, validateOutreachChannel } from '../src/lib/agents/outreach-agent.ts'

assert.equal(validateOutreachChannel('whatsapp'), true)
assert.equal(validateOutreachChannel('fax'), false)

const ok = checkOutreachGuardrails({ channel: 'email', dailySentCount: 10, daysSinceLastContact: 30 })
assert.equal(ok.allowed, true)
assert.equal(ok.severity, 'ok')

const block = checkOutreachGuardrails({ channel: 'whatsapp', dailySentCount: 80 })
assert.equal(block.allowed, false)
assert.equal(block.severity, 'block')

const warn = checkOutreachGuardrails({ channel: 'email', dailySentCount: 5, daysSinceLastContact: 2 })
assert.equal(warn.allowed, true)
assert.equal(warn.severity, 'warning')

console.log('[test-block8-outreach] OK')
