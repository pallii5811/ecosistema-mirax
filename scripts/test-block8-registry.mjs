/**
 * Blocco 8 — unit tests: agent registry
 */
import assert from 'node:assert/strict'
import { AGENT_REGISTRY, getAgentDescriptor, listAgentIds, PRESET_PIPELINES } from '../src/lib/agents/registry.ts'

assert.equal(AGENT_REGISTRY.length, 6)
assert.ok(listAgentIds().includes('search'))
assert.ok(listAgentIds().includes('insights'))
assert.equal(getAgentDescriptor('pitch')?.label, 'Pitch Agent')

assert.ok(Array.isArray(PRESET_PIPELINES.coach))
assert.deepEqual(PRESET_PIPELINES.coach, ['insights'])

console.log('[test-block8-registry] OK')
