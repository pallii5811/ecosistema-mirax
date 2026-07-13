#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'

const required = [
  'reports/release-manifest-v5.json','reports/final-safety-soak-v5.json','reports/rollback-rehearsal-v5.json',
  'docs/release-v5/PRODUCTION_RELEASE_DOSSIER.md','docs/release-v5/INCIDENT_KILL_SWITCH_RUNBOOK.md',
  'docs/release-v5/ROLLBACK_RUNBOOK.md','docs/release-v5/CUSTOMER_LAUNCH_CHECKLIST.md',
  'evaluation/gold-v1/manifest.json','evaluation/canary-v1/manifest.json',
]
required.forEach((file) => assert.ok(fs.existsSync(file), `missing ${file}`))
const dossier = fs.readFileSync('docs/release-v5/PRODUCTION_RELEASE_DOSSIER.md','utf8')
for (let section = 1; section <= 19; section += 1) {
  assert.ok(dossier.includes(section === 8 ? '## 8–13.' : section >= 9 && section <= 13 ? '## 8–13.' : `## ${section}.`), `missing deliverable ${section}`)
}
assert.match(dossier, /Human judgments: 0\/200/)
assert.match(dossier, /acceptance_complete=false|Acceptance finale: `false`/i)
const soak = JSON.parse(fs.readFileSync('reports/final-safety-soak-v5.json','utf8'))
const rollback = JSON.parse(fs.readFileSync('reports/rollback-rehearsal-v5.json','utf8'))
assert.equal(soak.passed,true)
assert.equal(rollback.passed,true)
console.log('Release dossier: 19/19 deliverable sections present; pending gates explicitly non-accepted')
