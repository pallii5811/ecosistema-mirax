/**
 * Blocco 5 — unit tests: knowledge feed draft rules (inline)
 */
import assert from 'node:assert/strict'

function draftsFromWonDeals(deals) {
  const out = []
  for (const d of deals) {
    const name = String(d.lead_name ?? '').trim()
    if (!name) continue
    out.push({ object_type: 'closure', title: `Chiusura: ${name}` })
  }
  return out
}

function draftsFromEnvironmentStats(stats) {
  const out = []
  if (stats.leads_no_pixel > 3) {
    out.push({ object_type: 'insight', title: 'Gap Meta Pixel' })
  }
  for (const cat of stats.top_categories ?? []) {
    if (cat.count >= 2) out.push({ object_type: 'correlation', title: cat.name })
  }
  return out
}

const won = draftsFromWonDeals([{ lead_name: 'Acme Srl' }])
assert.equal(won.length, 1)
assert.equal(won[0].object_type, 'closure')

const env = draftsFromEnvironmentStats({
  leads_no_pixel: 8,
  top_categories: [{ name: 'Elettricisti', count: 5 }],
})
assert.ok(env.some((d) => d.object_type === 'insight'))
assert.ok(env.some((d) => d.object_type === 'correlation'))

console.log('[test-block5-knowledge-feed] OK')
