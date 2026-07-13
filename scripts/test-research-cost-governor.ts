import assert from 'node:assert/strict'
import { ResearchBudgetExceededError, ResearchCostGovernor } from '../src/lib/research/cost-governor'

const governor = new ResearchCostGovernor(0.021, 0.025)
governor.reserve('search:1', 'search_web', 0.005)
governor.reserve('search:1', 'search_web', 0.005)
assert.equal(governor.committedCostEur, 0.005, 'idempotent reservation must not double-charge')
governor.settle('search:1', 0.004)
governor.reserve('crawl:1', 'open_page', 0.017)
assert.equal(governor.strategy, 'economy')
assert.throws(() => governor.reserve('llm:1', 'llm_evaluation', 0.005), ResearchBudgetExceededError)
governor.release('crawl:1')
assert.equal(governor.strategy, 'normal')
assert.equal(governor.snapshot().operations.length, 2)
console.log('Research cost governor: 6/6 OK')
