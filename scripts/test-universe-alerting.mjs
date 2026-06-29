#!/usr/bin/env node
/**
 * Fase 9 — alerting rules smoke (no DB).
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const alerting = fs.readFileSync('src/lib/universe/alerting.ts', 'utf8')
assert.ok(alerting.includes('UNIVERSE_ALERT_TYPES'))
assert.ok(alerting.includes("'new_hiring'"))
assert.ok(alerting.includes("'website_changed'"))
assert.ok(alerting.includes('dispatchUniverseEventAlerts'))
assert.ok(alerting.includes('universe_graph'))
console.log('✓ alerting module')

console.log('\n[test-universe-alerting] OK')
