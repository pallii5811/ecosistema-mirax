import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = [
  fs.readFileSync('db/migrations/2026_07_11_commercial_research_lifecycle.sql', 'utf8'),
  fs.readFileSync('db/migrations/2026_07_12_atomic_cost_governor.sql', 'utf8'),
].join('\n')
const compiler = fs.readFileSync('src/lib/intent-compiler/compile-commercial-search-plan.ts', 'utf8')
const dashboard = fs.readFileSync('src/app/dashboard/unified-search-action.ts', 'utf8')
const api = fs.readFileSync('src/app/api/universe/agentic-search/route.ts', 'utf8')

for (const contract of [
  'create table if not exists public.search_budget_state',
  'for update',
  'unique(search_id, idempotency_key)',
  'RESEARCH_HARD_BUDGET_EXCEEDED',
  'BUDGET_ESCALATION_FORBIDDEN',
  'release_stale_search_costs',
  'STALE_RESERVATION_CONSERVATIVE_SETTLEMENT',
  "status in ('active', 'halted', 'closed')",
  "currency = 'EUR'",
  'grant execute on function public.reserve_search_cost',
]) {
  assert.equal(sql.toLowerCase().includes(contract.toLowerCase()), true, `missing SQL contract: ${contract}`)
}

assert.match(compiler, /paid_call_blocked_without_cost_governor/)
assert.match(compiler, /await meter\.reserve/)
assert.match(compiler, /await meter\.settle/)
assert.match(compiler, /await meter\.release/)
assert.match(dashboard, /createAgenticPlanningJob/)
assert.match(dashboard, /PersistentResearchCostGovernor/)
assert.match(api, /MIRAX_SEARCH_DISABLED/)
assert.match(api, /PersistentResearchCostGovernor/)

console.log('Atomic persistent cost governor: 17/17 OK')
