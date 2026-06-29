#!/usr/bin/env node
/**
 * Fase 7 — Digital Twin + Universe Agent + Multi-agent wiring.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const files = [
  'src/lib/universe/digital-twin.ts',
  'src/lib/universe/user-context-repository.ts',
  'src/lib/agents/universe-agent.ts',
  'src/app/api/universe/entities/[id]/twin/route.ts',
  'src/app/api/universe/entities/[id]/context/route.ts',
  'src/components/universe/UniverseDigitalTwinPanel.tsx',
]

for (const f of files) {
  assert.ok(fs.existsSync(f), `mancante: ${f}`)
  console.log(`✓ ${f}`)
}

const index = fs.readFileSync('src/lib/universe/index.ts', 'utf8')
assert.ok(index.includes('buildDigitalTwin'), 'index deve esportare buildDigitalTwin')
assert.ok(index.includes('upsertUserContext'), 'index deve esportare upsertUserContext')
console.log('✓ index exports')

const registry = fs.readFileSync('src/lib/agents/registry.ts', 'utf8')
assert.ok(registry.includes("id: 'universe'"), 'registry senza universe agent')
assert.ok(registry.includes('graph_intel'), 'registry senza pipeline graph_intel')
assert.ok(registry.includes('graph_pitch'), 'registry senza pipeline graph_pitch')
console.log('✓ agent registry')

const orchestrator = fs.readFileSync('src/lib/agents/orchestrator.ts', 'utf8')
assert.ok(orchestrator.includes("case 'universe'"), 'orchestrator senza case universe')
console.log('✓ orchestrator')

const types = fs.readFileSync('src/lib/agents/types.ts', 'utf8')
assert.ok(types.includes("'universe'"), 'AgentId senza universe')
console.log('✓ agent types')

const entityPage = fs.readFileSync('src/app/dashboard/universe/[id]/page.tsx', 'utf8')
assert.ok(entityPage.includes('UniverseDigitalTwinPanel'), 'entity page senza Digital Twin')
assert.ok(entityPage.includes("'twin'"), 'entity page senza tab twin')
console.log('✓ entity page')

const client = fs.readFileSync('src/lib/universe/client.ts', 'utf8')
assert.ok(client.includes('getUniverseDigitalTwin'), 'client senza getUniverseDigitalTwin')
assert.ok(client.includes('runUniverseAgentPipeline'), 'client senza runUniverseAgentPipeline')
console.log('✓ client')

console.log('\n[test-universe-phase7] OK')
