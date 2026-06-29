#!/usr/bin/env node
/**
 * Fase 9 — query cache key stability (no DB).
 */
import assert from 'node:assert/strict'
import {
  buildUniverseCacheKey,
  cacheTtlSeconds,
  isUniverseCacheEnabled,
} from '../src/lib/universe/query-cache.ts'

const k1 = buildUniverseCacheKey('analytics', { days: 30 })
const k2 = buildUniverseCacheKey('analytics', { days: 30 })
const k3 = buildUniverseCacheKey('analytics', { days: 7 })
assert.equal(k1, k2)
assert.notEqual(k1, k3)
assert.ok(k1.startsWith('analytics:'))
console.log('✓ buildUniverseCacheKey')

assert.ok(cacheTtlSeconds('analytics') >= 30)
assert.ok(cacheTtlSeconds('agentic') >= 60)
console.log('✓ cacheTtlSeconds')

const saved = process.env.UNIVERSE_CACHE_ENABLED
process.env.UNIVERSE_CACHE_ENABLED = '1'
assert.equal(isUniverseCacheEnabled(), true)
if (saved === undefined) delete process.env.UNIVERSE_CACHE_ENABLED
else process.env.UNIVERSE_CACHE_ENABLED = saved
console.log('✓ isUniverseCacheEnabled')

console.log('\n[test-universe-query-cache] OK')
