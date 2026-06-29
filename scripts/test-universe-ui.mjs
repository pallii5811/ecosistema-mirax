#!/usr/bin/env node
/**
 * Smoke test UI Universe — wiring file (no browser).
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const pages = [
  'src/app/dashboard/universe/page.tsx',
  'src/app/dashboard/universe/[id]/page.tsx',
  'src/app/api/universe/entities/resolve/route.ts',
]

for (const p of pages) {
  assert.ok(fs.existsSync(p), `mancante: ${p}`)
  console.log(`✓ ${p}`)
}

const page = fs.readFileSync('src/app/dashboard/universe/page.tsx', 'utf8')
assert.ok(page.includes('AgenticSearchPanel'), 'universe page senza AgenticSearchPanel')
console.log('✓ universe page con Agentic Search')

const components = [
  'src/components/universe/UniverseEntityCard.tsx',
  'src/components/universe/UniverseLeadPanel.tsx',
  'src/components/universe/UniverseTimeline.tsx',
  'src/components/universe/AgenticSearchPanel.tsx',
  'src/lib/universe/client.ts',
  'src/lib/universe/labels.ts',
  'src/lib/universe/agentic-ui.ts',
]

for (const p of components) {
  assert.ok(fs.existsSync(p), `mancante: ${p}`)
  console.log(`✓ ${p}`)
}

const sidebar = fs.readFileSync('src/components/Sidebar.tsx', 'utf8')
assert.ok(sidebar.includes('Knowledge Graph'), 'Sidebar senza voce Knowledge Graph')
assert.ok(sidebar.includes('/dashboard/universe'), 'Sidebar senza href universe')

const lead = fs.readFileSync('src/app/dashboard/lead/[searchId]/[leadIndex]/LeadDetailClient.tsx', 'utf8')
assert.ok(lead.includes('UniverseLeadPanel'), 'Lead detail senza UniverseLeadPanel')

console.log('\n[test-universe-ui] OK')
