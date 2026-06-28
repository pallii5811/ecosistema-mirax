/**
 * Blocco 7 — unit tests: NOUS adapter registry
 */
import assert from 'node:assert/strict'
import { getNousAdapter, supportedIntegrationTypes } from '../src/lib/nous/registry.ts'
import { dynamicsAdapter } from '../src/lib/nous/adapters/dynamics.ts'

const types = supportedIntegrationTypes()
assert.ok(types.includes('hubspot'))
assert.ok(types.includes('webhook'))
assert.ok(types.includes('salesforce'))

assert.equal(getNousAdapter('hubspot')?.type, 'hubspot')
assert.equal(getNousAdapter('unknown'), null)

const stub = await dynamicsAdapter.dispatch({
  integration: { id: 'x', type: 'dynamics', config: {} },
  event: 'lead.exported',
  leads: [
    {
      nome: 'X',
      sito: '',
      email: '',
      telefono: '',
      citta: '',
      categoria: '',
      score: 0,
      opportunita: { no_pixel: false, no_gtm: false, errori_seo: 0 },
      raw: {},
    },
  ],
})
assert.equal(stub[0].status, 'error')
assert.ok(stub[0].error?.includes('Dynamics'))

console.log('[test-block7-registry] OK')
