/**
 * Blocco 5 — unit tests: CKBase-lite embeddings
 */
import assert from 'node:assert/strict'
import { cosineSimilarity, liteTextEmbedding } from '../src/lib/knowledge-embeddings.ts'

const a = liteTextEmbedding('idraulici verona senza meta pixel')
const b = liteTextEmbedding('idraulici verona missing facebook pixel')
const c = liteTextEmbedding('ristoranti milano')

assert.equal(a.length, 384)
assert.ok(cosineSimilarity(a, a) > 0.99)
assert.ok(cosineSimilarity(a, b) > cosineSimilarity(a, c))

console.log('[test-block5-embeddings] OK')
