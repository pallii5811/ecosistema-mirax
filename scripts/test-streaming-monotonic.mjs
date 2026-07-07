/**
 * Test: streaming display non deve mai far scendere il conteggio lead.
 * Run: npx tsx scripts/test-streaming-monotonic.mjs
 */
import assert from 'node:assert/strict'
import {
  applyStreamingDisplay,
  mergeLeadsMonotonic,
  normalizeStreamingBatch,
} from '../src/lib/search-streaming/display-results.ts'

const opts = {
  query: 'aziende che stanno investendo in marketing',
  maxLeads: 2000,
  credits: 5000,
  activeFilters: null,
  scraping: true,
}

let display = []

// Batch 1: 3 lead con sito
const b1 = normalizeStreamingBatch(
  [
    { azienda: 'Partoo Italia', sito: 'partoo.it', tech_stack: ['Verifica in corso'] },
    { azienda: 'DigiLead', sito: 'digilead.it', tech_stack: ['Verifica in corso'] },
    { azienda: 'Passo al Marketing', sito: 'passoalmarketing.it', tech_stack: ['Verifica in corso'] },
  ],
  opts,
)
let r = applyStreamingDisplay(display, b1, opts)
display = r.display
assert.equal(display.length, 3, 'batch1: 3 lead')

// Batch 2: poll vuoto (errore rete) — NON deve azzerare
r = applyStreamingDisplay(display, [], opts)
assert.equal(r.display.length, 3, 'empty poll: still 3')

// Batch 3: solo 1 lead dal DB parziale — NON deve scendere a 1
const b3 = normalizeStreamingBatch(
  [{ azienda: 'Partoo Italia', sito: 'partoo.it', telefono: '02 1234567', tech_stack: ['SSL', 'Meta Pixel'] }],
  opts,
)
r = applyStreamingDisplay(display, b3, opts)
display = r.display
assert.equal(display.length, 3, 'partial db: still 3')
assert.equal(String(display[0].telefono), '02 1234567', 'enriched phone merged')

// Batch 4: 2 nuovi lead
const b4 = normalizeStreamingBatch(
  [
    { azienda: 'Nuova Agenzia', sito: 'nuovaagenzia.it' },
    { azienda: 'Altra Agenzia', sito: 'altraagenzia.it' },
  ],
  opts,
)
r = applyStreamingDisplay(display, b4, opts)
display = r.display
assert.equal(display.length, 5, 'growth: 5 lead')

// Merge monotonic: prev 5 + empty incoming
const m = mergeLeadsMonotonic(display, [])
assert.equal(m.length, 5, 'merge empty keeps 5')

console.log('OK test-streaming-monotonic: 5 checks passed')
