#!/usr/bin/env node
/**
 * Fase 6 — MIRAX Research Agent tests (mock, no API cost)
 */
import { RESEARCH_SYSTEM_PROMPT } from '../src/lib/research/prompt.ts'
import { verifyFact, readPage, checkApi } from '../src/lib/research/tools.ts'

function researchCacheKey(leadWebsite, query) {
  const base = (leadWebsite || 'unknown').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  const q = (query || '').toLowerCase().trim().slice(0, 80)
  return q ? `${base}::${q}` : base
}

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log(`✓ ${label}`)
}
function fail(label, detail) {
  failed += 1
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('═══ MIRAX Research Agent (Fase 6) ═══\n')

if (RESEARCH_SYSTEM_PROMPT.includes('MIRAX Research Agent')) ok('system prompt MIRAX presente')
else fail('system prompt')

if (RESEARCH_SYSTEM_PROMPT.includes('NON inventare')) ok('regola no-invent')
else fail('regola no-invent')

const key = researchCacheKey('https://example.com', 'hiring')
if (key.includes('example.com')) ok('cache key format')
else fail('cache key', key)

const badUrl = await readPage({ url: 'not-a-url' })
if (!badUrl.ok) ok('read_page rifiuta URL invalido')
else fail('read_page invalid')

const badApi = await checkApi({ endpoint: 'https://evil.com/hack' })
if (!badApi.ok && String(badApi.error).includes('non consentito')) ok('check_api host allowlist')
else fail('check_api allowlist', badApi.error)

const vf = await verifyFact({ claim: 'xyzunknownterm123', sources: ['https://example.com'] })
if (vf.ok && typeof vf.data === 'object') ok('verify_fact ritorna agreement_score')
else fail('verify_fact')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
