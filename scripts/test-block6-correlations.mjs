/**
 * Blocco 6 — unit tests: environment mesh correlations
 */
import assert from 'node:assert/strict'
import { buildEnvironmentMesh } from '../src/lib/environment-correlations.ts'

const mesh = buildEnvironmentMesh([
  { categoria: 'Frigo', citta: 'Verona', meta_pixel: false, email: 'a@b.it', opportunity_score: 75 },
  { categoria: 'Frigo', citta: 'Verona', meta_pixel: false, telefono: '333', opportunity_score: 80 },
  { categoria: 'Hotel', citta: 'Milano', meta_pixel: true, opportunity_score: 40 },
])

assert.equal(mesh.totalLeads, 3)
assert.ok(mesh.correlations.some((c) => c.signal === 'no_pixel'))
assert.equal(mesh.categories[0].category, 'Frigo')
assert.equal(mesh.categories[0].count, 2)
assert.equal(mesh.cities[0].city, 'Verona')

const empty = buildEnvironmentMesh([])
assert.equal(empty.totalLeads, 0)
assert.deepEqual(empty.correlations, [])

console.log('[test-block6-correlations] OK')
