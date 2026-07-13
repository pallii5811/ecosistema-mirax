import assert from 'node:assert/strict'
import {
  filterLeadsDeterministic,
  inferQueryCategoryKey,
  isCacheRelevantEnough,
  graphCategoryTokenForQuery,
} from '../src/lib/lead-relevance.ts'

const edile = { nome: 'Impresa Edile Rossi', categoria: 'Impresa edile' }
const software = { nome: 'NEXT Software Srl', categoria: 'Software house' }
const ristorante = { nome: 'Trattoria da Mario', categoria: 'Ristorante' }

assert.equal(inferQueryCategoryKey('software house a Bologna'), 'software')

const filtered = filterLeadsDeterministic([edile, software, ristorante], 'software house a Bologna')
assert.equal(filtered.length, 1)
assert.equal(filtered[0].nome, 'NEXT Software Srl')

const polluted = [edile, edile, edile, software]
assert.equal(isCacheRelevantEnough(polluted, 'software house a Bologna'), false)

const clean = [software, software, software, edile]
assert.equal(isCacheRelevantEnough(clean, 'software house a Bologna'), true)

assert.equal(filterLeadsDeterministic([edile], 'imprese edili a Roma').length, 1)
assert.equal(filterLeadsDeterministic([software], 'imprese edili a Roma').length, 0)

const marketingQuery = 'agenzie marketing a Milano che stanno assumendo commerciali'
assert.equal(filterLeadsDeterministic([ristorante, edile], marketingQuery).length, 0)
assert.equal(graphCategoryTokenForQuery(marketingQuery), 'marketing')
assert.equal(inferQueryCategoryKey('agenzie a Milano che stanno investendo in marketing'), 'marketing')
assert.equal(inferQueryCategoryKey('startup a milano che stanno cercando fondi'), 'startup')

console.log('test-lead-relevance: OK')
