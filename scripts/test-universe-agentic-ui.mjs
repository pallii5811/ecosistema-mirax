#!/usr/bin/env node
/**
 * Fase 5 — Agentic Search UI wiring + smoke checks.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const files = [
  'src/lib/universe/agentic-ui.ts',
  'src/components/universe/AgenticSearchPanel.tsx',
  'src/components/universe/AgenticIntentBreakdown.tsx',
  'src/components/universe/AgenticQueryPlan.tsx',
  'src/components/universe/AgenticResultsTable.tsx',
  'src/components/universe/AgenticResultsCards.tsx',
  'src/components/universe/UniverseGraphStats.tsx',
  'src/components/universe/UniverseExplorerPanel.tsx',
]

for (const f of files) {
  assert.ok(fs.existsSync(f), `mancante: ${f}`)
  console.log(`✓ ${f}`)
}

const page = fs.readFileSync('src/app/dashboard/universe/page.tsx', 'utf8')
assert.ok(page.includes('UniverseGraphCanvas'), 'universe page senza grafo visuale')
assert.ok(page.includes('UniverseExplorerPanel'), 'universe page senza tab Esplora')
assert.ok(page.includes('Grafo visuale'), 'universe page senza tab grafo')
assert.ok(page.includes('useSearchParams'), 'universe page deve leggere parametri da URL')
assert.ok(page.includes('setTabWithUrl'), 'universe page deve sincronizzare ?tab= URL')
assert.ok(page.includes('UniverseWebhookDeliveriesPanel'), 'universe page deve avere webhook panel')
console.log('✓ universe page')

const client = fs.readFileSync('src/lib/universe/client.ts', 'utf8')
assert.ok(client.includes('runAgenticUniverseSearch'), 'client senza runAgenticUniverseSearch')
assert.ok(client.includes('elapsed_ms'), 'client deve tipizzare elapsed_ms')
console.log('✓ client')

const route = fs.readFileSync('src/app/api/universe/agentic-search/route.ts', 'utf8')
assert.ok(route.includes('signal_intent'), 'API agentic-search deve restituire signal_intent')
assert.ok(route.includes('elapsed_ms'), 'API agentic-search deve restituire elapsed_ms')
console.log('✓ API route')

const panel = fs.readFileSync('src/components/universe/AgenticSearchPanel.tsx', 'utf8')
assert.ok(panel.includes('AGENTIC_EXAMPLE_QUERIES'), 'panel senza esempi query')
assert.ok(panel.includes('AgenticIntentBreakdown'), 'panel senza intent breakdown')
assert.ok(panel.includes('AgenticResultsResponsive'), 'panel senza layout responsive')
assert.ok(panel.includes('agenticResultsToCsv'), 'panel senza export CSV')
assert.ok(panel.includes('UniverseGraphStats'), 'panel senza stats banner')
assert.ok(panel.includes('void runSearch(ex)'), 'esempi devono avviare ricerca al click')
assert.ok(panel.includes('graph_score'), 'panel deve mostrare hint Graph Rank')
console.log('✓ AgenticSearchPanel')

const shell = fs.readFileSync('src/components/DashboardShell.tsx', 'utf8')
assert.ok(shell.includes('SearchSourceToggle'), 'DashboardShell senza toggle sorgente ricerca')
assert.ok(shell.includes('runAgenticUniverseSearch'), 'DashboardShell senza ricerca grafo integrata')
assert.ok(shell.includes('Visualizza nel grafo'), 'DashboardShell senza CTA grafo visuale')
console.log('✓ DashboardShell ricerca unificata')

console.log('\n[test-universe-agentic-ui] OK')
