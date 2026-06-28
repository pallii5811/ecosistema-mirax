/**
 * Unit test search-cache helpers (no DB).
 */
import assert from 'node:assert/strict'
import {
  normalizeSearchKey,
  formatCanonicalLabel,
  dedupeSearchLeads,
  parseSearchResults,
} from '../src/lib/search-cache.ts'

assert.equal(normalizeSearchKey('  Imprese Edili '), 'imprese edili')
assert.equal(formatCanonicalLabel('imprese edili'), 'Imprese Edili')

const duped = dedupeSearchLeads([
  { nome: 'A', sito: 'https://www.foo.it', telefono: '123' },
  { nome: 'A copy', sito: 'http://foo.it/', telefono: '456' },
  { nome: 'B', email: 'b@test.com' },
])
assert.equal(duped.length, 2)

assert.equal(parseSearchResults(JSON.stringify([{ x: 1 }])).length, 1)

console.log('[test-search-cache] OK')
