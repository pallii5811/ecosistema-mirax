/**
 * Blocco 5 — unit tests: environment graph builder
 */
import assert from 'node:assert/strict'
import { buildEnvironmentGraph } from '../src/lib/environment-graph.ts'

const { nodes, edges } = buildEnvironmentGraph({
  environmentId: 'env-1',
  envName: 'Idraulici Nord',
  envColor: '#8B5CF6',
  totalLeads: 42,
  lists: [{ id: 'l1', name: 'Verona', description: null, created_at: '2026-01-01', leadsCount: 20 }],
  stats: {
    total_leads: 42,
    avg_score: 65,
    leads_with_email: 30,
    leads_with_phone: 35,
    leads_no_pixel: 18,
    leads_no_gtm: 10,
    top_categories: [{ name: 'Idraulici', count: 25 }],
    top_cities: [{ name: 'Verona', count: 20 }],
  },
  knowledge: [{ id: 'k1', title: 'Gap Meta Pixel', object_type: 'insight', confidence: 0.8 }],
})

assert.ok(nodes.some((n) => n.kind === 'environment'))
assert.ok(nodes.some((n) => n.kind === 'list'))
assert.ok(nodes.some((n) => n.kind === 'category'))
assert.ok(nodes.some((n) => n.kind === 'knowledge'))
assert.ok(edges.length >= 3)

console.log('[test-block5-graph] OK')
