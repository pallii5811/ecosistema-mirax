import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('db/migrations/2026_07_11_commercial_research_lifecycle.sql', 'utf8')
const shadowSql = fs.readFileSync('db/migrations/2026_07_13_shadow_candidate_isolation.sql', 'utf8')
const atomicPublicationSql = fs.readFileSync('db/migrations/2026_07_14_atomic_publication_credit.sql', 'utf8')

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
for (const invariant of [
  'CUSTOMER_OWNER_REQUIRED',
  'INSUFFICIENT_CREDITS',
  'PUBLICATION_CHARGE_CONFLICT',
  'for update',
  'search_credit_charges',
  'on conflict do nothing',
]) {
  assert.equal(atomicPublicationSql.toLowerCase().includes(invariant.toLowerCase()), true, `missing atomic publication invariant ${invariant}`)
}
assert.match(atomicPublicationSql, /revoke all on function public\.publish_search_candidate\(uuid\) from public, anon, authenticated/)
console.log('Commercial research lifecycle schema: 21/21 OK')
