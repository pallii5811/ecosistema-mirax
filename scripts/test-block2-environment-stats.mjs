/**
 * Blocco 2 — unit tests: environment stats aggregation (2.7)
 */
import assert from 'node:assert/strict'

function calculateTopItems(leads, field) {
  const counts = {}
  for (const lead of leads) {
    const value = String(lead?.[field] ?? '').trim()
    if (!value) continue
    counts[value] = (counts[value] || 0) + 1
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

const leads = [
  { categoria: 'Idraulici', citta: 'Verona', email: 'a@x.it', telefono: '333', meta_pixel: false },
  { categoria: 'Idraulici', citta: 'Verona', email: '', telefono: '', meta_pixel: true },
  { categoria: 'Elettricisti', citta: 'Mantova', email: 'b@y.it', telefono: '334', google_tag_manager: false },
]

const cats = calculateTopItems(leads, 'categoria')
assert.equal(cats[0].name, 'Idraulici')
assert.equal(cats[0].count, 2)

const stats = {
  total_leads: leads.length,
  leads_with_email: leads.filter((l) => !!l.email).length,
  leads_with_phone: leads.filter((l) => !!l.telefono).length,
  leads_no_pixel: leads.filter((l) => !l.meta_pixel).length,
  top_categories: cats,
}

assert.equal(stats.total_leads, 3)
assert.equal(stats.leads_with_email, 2)
assert.equal(stats.leads_no_pixel, 2)

console.log('[test-block2-environment-stats] OK')
