/**
 * Self-check anti-enterprise guard — no network, no LLM.
 * Run: npx tsx scripts/test-enterprise-lead-guard.ts
 */
import { strict as assert } from 'node:assert'
import { shouldRejectEnterpriseLead } from '../src/lib/lead-enterprise-guard'
import { filterLeadsDeterministic } from '../src/lib/lead-relevance'
import { normalizeStreamingBatch } from '../src/lib/search-streaming/display-results'

const query = 'trovami PMI a Milano e Torino che stanno investendo in marketing'

const uniqlo = {
  azienda: 'Uniqlo',
  sito: 'https://www.uniqlo.com/it/it/home',
  telefono: '0230457387',
}
const nike = {
  azienda: 'Nike Milano',
  sito: 'https://www.nike.com/it/retail/s/nike-milano',
  telefono: '0272095460',
}
const ferrariStore = {
  azienda: 'Ferrari Flagship Store Milano',
  sito: 'https://store.ferrari.com/store-locator/milano',
  telefono: '0249490815',
}
const realPmi = {
  azienda: 'Rossi Growth Srl',
  sito: 'https://rossigrowth.it',
  telefono: '0111234567',
}
const localHomonym = {
  azienda: 'Ferrari Nautica SRL',
  sito: 'https://ferrarinautica.it',
  telefono: '0187123456',
}

for (const lead of [uniqlo, nike, ferrariStore]) {
  assert.equal(shouldRejectEnterpriseLead(lead, query), true, `${lead.azienda} deve essere escluso`)
}
assert.equal(shouldRejectEnterpriseLead(realPmi, query), false, 'PMI reale deve restare')
assert.equal(shouldRejectEnterpriseLead(localHomonym, query), false, 'omonimo PMI non va escluso solo per il cognome Ferrari')

const deterministic = filterLeadsDeterministic([uniqlo, nike, ferrariStore, realPmi, localHomonym], query)
assert.deepEqual(
  deterministic.map((lead) => lead.azienda),
  ['Rossi Growth Srl', 'Ferrari Nautica SRL'],
)

const streaming = normalizeStreamingBatch([uniqlo, nike, ferrariStore, realPmi, localHomonym], {
  query,
  maxLeads: 10,
  credits: 10,
  activeFilters: null,
  scraping: true,
})
assert.deepEqual(
  streaming.map((lead) => lead.azienda),
  ['Rossi Growth Srl', 'Ferrari Nautica SRL'],
)

console.log('OK enterprise lead guard')
