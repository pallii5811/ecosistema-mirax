#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
const manifest = JSON.parse(fs.readFileSync('evaluation/canary-v1/manifest.json', 'utf8'))
assert.equal(manifest.canaries.length, 10)
assert.equal(new Set(manifest.canaries.map((row) => row.vertical)).size, 10)
assert.equal(manifest.shadow_mode, true)
assert.equal(manifest.customer_visible, false)
assert.equal(manifest.worker_limit, 1)
assert.ok(manifest.max_leads_per_canary <= 5)
assert.ok(manifest.hard_budget_eur_per_canary <= manifest.max_leads_per_canary * 0.025)
assert.equal(manifest.stop_on_first_failed_gate, true)
for (const row of manifest.canaries) {
  assert.ok(row.query.length >= 80)
  assert.match(row.query, /PMI|manifatturiere/i)
}
assert.equal(manifest.acceptance.evidence_coverage, 1)
assert.equal(manifest.acceptance.official_domain_coverage, 1)
assert.equal(manifest.acceptance.cost_per_published_lead_eur_max, 0.025)
console.log(`Multi-vertical canary manifest: 10/10 verticals; maximum suite budget €${(manifest.canaries.length * manifest.hard_budget_eur_per_canary).toFixed(3)}`)
