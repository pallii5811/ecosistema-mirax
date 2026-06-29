#!/usr/bin/env node
/**
 * Unit tests for Universe SDK (canonical + query builder, no DB).
 * Run: node scripts/test-universe-sdk.mjs
 */
import assert from 'node:assert/strict'
import {
  normalizeDomain,
  normalizePhone,
  normalizeEmail,
  normalizeVat,
  slugifyTechnology,
  slugifyLocation,
  slugifyName,
  buildNoPixelRomaQuery,
  buildHiringMilanoQuery,
} from '../src/lib/universe/index.ts'

// Canonical tests
assert.equal(normalizeDomain('https://www.MiraxGroup.IT/'), 'miraxgroup.it')
assert.equal(normalizeDomain('foo.it'), 'foo.it')
assert.equal(normalizeDomain(null), null)

assert.equal(normalizePhone('+39 333 123 4567'), '393331234567')
assert.equal(normalizePhone('3331234567'), '393331234567')
assert.equal(normalizePhone('123'), null)

assert.equal(normalizeEmail(' Test@EXAMPLE.com '), 'test@example.com')
assert.equal(normalizeEmail('invalid'), null)

assert.equal(normalizeVat('12345678901'), 'IT12345678901')
assert.equal(normalizeVat('IT 123.4567.8901'), 'IT12345678901')
assert.equal(normalizeVat('123'), null)

assert.equal(slugifyTechnology('Meta Pixel'), 'meta_pixel')
assert.equal(slugifyTechnology('WordPress'), 'wordpress')

assert.equal(slugifyLocation('Roma'), 'it:roma')
assert.equal(slugifyLocation('Milano', 'IT'), 'it:milano')

assert.equal(slugifyName('Edil Costruzioni Srl'), 'edil-costruzioni-srl')

// Query builder tests
const q1 = buildNoPixelRomaQuery()
assert.equal(q1.entity_type, 'company')
assert.equal(q1.filters.city, 'Roma')
assert.equal(q1.filters.observations[0].attribute, 'meta_pixel')
assert.equal(q1.filters.observations[0].value, false)

const q2 = buildHiringMilanoQuery('programmatore')
assert.equal(q2.entity_type, 'company')
assert.equal(q2.relationships[0].relationship_type, 'hires')
assert.equal(q2.relationships[0].target_entity_type, 'job')

console.log('[test-universe-sdk] OK')
