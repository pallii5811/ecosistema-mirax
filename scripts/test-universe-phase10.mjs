#!/usr/bin/env node
/**
 * Fase 10 — webhooks + ranking + archive wiring.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const files = [
  'db/migrations/2026_07_05_universe_webhooks_ranking.sql',
  'src/lib/universe/graph-ranking.ts',
  'src/lib/universe/webhooks.ts',
  'src/lib/universe/event-archive.ts',
  'src/components/universe/UniverseWebhookDeliveriesPanel.tsx',
  'src/components/universe/SaveToGraphButton.tsx',
  'src/app/api/universe/webhooks/deliveries/route.ts',
]

for (const f of files) {
  assert.ok(fs.existsSync(f), `mancante: ${f}`)
  console.log(`✓ ${f}`)
}

const migration = fs.readFileSync('db/migrations/2026_07_05_universe_webhooks_ranking.sql', 'utf8')
assert.ok(migration.includes('universe_webhook_deliveries'), 'migration senza webhook log')
assert.ok(migration.includes('universe_archive_old_events'), 'migration senza archive fn')
console.log('✓ migration')

const agentic = fs.readFileSync('src/lib/universe/agentic-search.ts', 'utf8')
assert.ok(agentic.includes('rankUniverseEntities'), 'agentic-search senza ranking')
assert.ok(agentic.includes('graph_score'), 'agentic-search senza graph_score')
assert.ok(agentic.includes('graph_rank_factors'), 'agentic-search senza evidence factors')
console.log('✓ agentic ranking')

const table = fs.readFileSync('src/components/universe/AgenticResultsTable.tsx', 'utf8')
assert.ok(table.includes('buildGraphRankEvidence'), 'tabella senza evidence')
assert.ok(table.includes('SaveToGraphButton'), 'tabella senza salva')
const cards = fs.readFileSync('src/components/universe/AgenticResultsCards.tsx', 'utf8')
assert.ok(cards.includes('SaveToGraphButton'), 'card senza salva')
const saveBtn = fs.readFileSync('src/components/universe/SaveToGraphButton.tsx', 'utf8')
assert.ok(saveBtn.includes('setUniverseUserContext'), 'SaveToGraphButton senza azione context')
console.log('✓ evidence + save UI')

const consumer = fs.readFileSync('src/lib/universe/event-consumer.ts', 'utf8')
assert.ok(consumer.includes('dispatchUniverseEventWebhooks'), 'consumer senza webhooks')
assert.ok(consumer.includes('archiveOldUniverseEvents'), 'consumer senza archive')
console.log('✓ event consumer')

const apply = fs.readFileSync('scripts/apply-mirax-migrations.mjs', 'utf8')
assert.ok(apply.includes('2026_07_05_universe_webhooks_ranking.sql'), 'apply-migrations senza fase 10')
console.log('✓ apply migrations')

console.log('\n[test-universe-phase10] OK')
