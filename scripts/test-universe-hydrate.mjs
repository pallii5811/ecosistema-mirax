#!/usr/bin/env node
/**
 * Fase 6 — hydrate-leads flag + merge logic smoke (no DB).
 * Run: node --experimental-strip-types scripts/test-universe-hydrate.mjs
 */
import assert from 'node:assert/strict'
import { isUniverseReadEnabled } from '../src/lib/universe/hydrate-leads.ts'

const savedRead = process.env.UNIVERSE_READ_ENABLED
const savedEnabled = process.env.UNIVERSE_ENABLED

try {
  delete process.env.UNIVERSE_READ_ENABLED
  delete process.env.UNIVERSE_ENABLED
  assert.equal(isUniverseReadEnabled(), false)

  process.env.UNIVERSE_READ_ENABLED = '0'
  process.env.UNIVERSE_ENABLED = '0'
  assert.equal(isUniverseReadEnabled(), false)

  process.env.UNIVERSE_READ_ENABLED = '1'
  assert.equal(isUniverseReadEnabled(), true)

  process.env.UNIVERSE_READ_ENABLED = '0'
  process.env.UNIVERSE_ENABLED = '1'
  assert.equal(isUniverseReadEnabled(), true)

  console.log('✓ isUniverseReadEnabled')
} finally {
  if (savedRead === undefined) delete process.env.UNIVERSE_READ_ENABLED
  else process.env.UNIVERSE_READ_ENABLED = savedRead
  if (savedEnabled === undefined) delete process.env.UNIVERSE_ENABLED
  else process.env.UNIVERSE_ENABLED = savedEnabled
}

console.log('\n[test-universe-hydrate] OK')
