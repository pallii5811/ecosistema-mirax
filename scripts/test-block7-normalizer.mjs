/**
 * Blocco 7 — unit tests: NOUS normalizer
 */
import assert from 'node:assert/strict'
import { normalizeLead, normalizeLeads } from '../src/lib/nous/normalizer.ts'

const lead = normalizeLead({
  azienda: 'Acme Srl',
  website: 'https://acme.it/',
  email: 'info@acme.it',
  score: 72,
  meta_pixel: false,
  google_tag_manager: true,
  seo_errors: ['title'],
})

assert.equal(lead.nome, 'Acme Srl')
assert.equal(lead.sito, 'https://acme.it/')
assert.equal(lead.email, 'info@acme.it')
assert.equal(lead.score, 72)
assert.equal(lead.opportunita.no_pixel, true)
assert.equal(lead.opportunita.no_gtm, false)
assert.equal(lead.opportunita.errori_seo, 1)

const batch = normalizeLeads([{ nome: 'A' }, { nome: 'B' }])
assert.equal(batch.length, 2)

console.log('[test-block7-normalizer] OK')
