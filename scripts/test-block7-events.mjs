/**
 * Blocco 7 — unit tests: NOUS events envelope
 */
import assert from 'node:assert/strict'
import {
  NOUS_EVENTS,
  buildNousEnvelope,
  integrationSubscribesToEvent,
  mapMiraxEventToNous,
} from '../src/lib/nous/events.ts'

const single = buildNousEnvelope(NOUS_EVENTS.LEAD_EXPORTED, {
  leads: [
    {
      nome: 'Test',
      sito: 'https://t.it',
      email: '',
      telefono: '',
      citta: 'Roma',
      categoria: 'Hotel',
      score: 50,
      opportunita: { no_pixel: true, no_gtm: false, errori_seo: 0 },
    },
  ],
})

assert.equal(single.event, 'lead.exported')
assert.equal(single.version, '1.0')
assert.ok(single.lead)
assert.equal(single.lead.nome, 'Test')

const bulk = buildNousEnvelope(NOUS_EVENTS.LEADS_EXPORTED, {
  leads: [single.lead, { ...single.lead, nome: 'B' }],
})
assert.equal(bulk.count, 2)
assert.ok(Array.isArray(bulk.leads))

assert.equal(mapMiraxEventToNous('outreach.sent'), NOUS_EVENTS.OUTREACH_LOGGED)
assert.equal(integrationSubscribesToEvent({}, 'lead.exported'), true)
assert.equal(integrationSubscribesToEvent({ events: ['pipeline.won'] }, 'lead.exported'), false)

console.log('[test-block7-events] OK')
