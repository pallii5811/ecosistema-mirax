import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('db/migrations/2026_07_11_commercial_research_lifecycle.sql', 'utf8')
const shadowSql = fs.readFileSync('db/migrations/2026_07_13_shadow_candidate_isolation.sql', 'utf8')

for (const table of ['search_candidates', 'search_evidence', 'search_cost_ledger', 'search_publications']) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`))
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
}
for (const gate of [
  'official_domain_verified',
  'target_fit_verified',
  'signal_verified',
  'evidence_policy_passed',
  'audit_completed',
  'MISSING_PUBLISHABLE_EVIDENCE',
]) {
  assert.equal(sql.includes(gate), true, `missing publication gate ${gate}`)
}
assert.match(sql, /revoke all on function public\.publish_search_candidate\(uuid\) from public, anon, authenticated/)
assert.match(sql, /unique\(search_id, idempotency_key\)/)
assert.match(shadowSql, /alter column user_id drop not null/)
assert.match(shadowSql, /stage <> 'published' or user_id is not null/)
console.log('Commercial research lifecycle schema: 14/14 OK')
