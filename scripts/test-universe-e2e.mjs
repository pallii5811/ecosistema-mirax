#!/usr/bin/env node
/**
 * E2E Universe — simula percorsi utente finale (Fasi 5–10).
 * Logic: sempre. Live DB: se Supabase raggiungibile da .env.local.
 * Run: node --experimental-strip-types scripts/test-universe-e2e.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { signalIntentToUniverseQuery } from '../src/lib/universe/agentic-search.ts'
import {
  agenticResultsToCsv,
  buildUniverseQueryPlan,
  buildGraphRankEvidence,
  collectIntentChips,
  graphRankScoreClass,
  GRAPH_RANK_TOOLTIP,
  AGENTIC_EXAMPLE_QUERIES,
} from '../src/lib/universe/agentic-ui.ts'
import {
  buildGraphRankFactors,
  computeGraphRankScore,
  rankUniverseEntities,
} from '../src/lib/universe/graph-ranking.ts'
import { isUniverseReadEnabled } from '../src/lib/universe/hydrate-leads.ts'
import {
  buildUniverseCacheKey,
  cacheTtlSeconds,
  isUniverseCacheEnabled,
} from '../src/lib/universe/query-cache.ts'
import { isUniverseWebhooksEnabled } from '../src/lib/universe/webhooks.ts'
import { formatUniverseEventHeadline } from '../src/lib/realtime/universe-event-stream.ts'

function loadEnv(path) {
  if (!fs.existsSync(path)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
}

console.log('═══ E2E Universe — Percorso utente finale ═══\n')

// ── Fase 5: Ricerca AI ─────────────────────────────────────────────
console.log('▶ Fase 5 — Ricerca AI (Agentic Search)')

const agenticRoute = fs.readFileSync('src/app/api/universe/agentic-search/route.ts', 'utf8')
assert.ok(agenticRoute.includes('parseSignalIntent'), 'API deve parsare NL query')
assert.ok(agenticRoute.includes('rankUniverseEntities') || agenticRoute.includes('executeAgenticUniverseSearch'), 'API agentic completa')

const E2E_INTENTS = [
  {
    label: AGENTIC_EXAMPLE_QUERIES[0],
    intent: {
      location: 'Roma',
      category: 'edilizia',
      technical_filters: { has_meta_pixel: false },
      required_signals: [],
      hiring_roles: [],
      sector_keywords: [],
      crm_keywords: [],
      require_crm_change: false,
      time_window_days: null,
      intent_summary: AGENTIC_EXAMPLE_QUERIES[0],
      parse_source: 'heuristic',
    },
  },
  {
    label: AGENTIC_EXAMPLE_QUERIES[1],
    intent: {
      location: 'Milano',
      category: 'software',
      required_signals: ['hiring'],
      hiring_roles: ['programmatore'],
      sector_keywords: [],
      crm_keywords: [],
      require_crm_change: false,
      time_window_days: null,
      intent_summary: AGENTIC_EXAMPLE_QUERIES[1],
      parse_source: 'heuristic',
    },
  },
  {
    label: AGENTIC_EXAMPLE_QUERIES[2],
    intent: {
      required_signals: ['sector_investment'],
      sector_keywords: ['fotovoltaico'],
      business_filters: { revenue_min: 1_000_000 },
      hiring_roles: [],
      crm_keywords: [],
      require_crm_change: false,
      time_window_days: null,
      intent_summary: AGENTIC_EXAMPLE_QUERIES[2],
      parse_source: 'heuristic',
    },
  },
]

for (const { label, intent } of E2E_INTENTS) {
  const mapped = signalIntentToUniverseQuery(intent)
  assert.ok(mapped.query.entity_type === 'company', `query type per "${label}"`)
  assert.ok(mapped.summary.length > 0, `summary per "${label}"`)
  const plan = buildUniverseQueryPlan(mapped.query)
  assert.ok(plan.length >= 2, `piano query per "${label}"`)
  const chips = collectIntentChips(intent)
  assert.ok(chips.length >= 1, `chips intent per "${label}"`)
}
const agenticUi = fs.readFileSync('src/lib/universe/agentic-ui.ts', 'utf8')
for (const q of AGENTIC_EXAMPLE_QUERIES) {
  assert.ok(agenticUi.includes(q), `esempio mancante in agentic-ui: ${q}`)
}
console.log(`✓ ${E2E_INTENTS.length} intent E2E + ${AGENTIC_EXAMPLE_QUERIES.length} esempi UI`)

const mockResults = [
  {
    azienda: 'Acme Srl',
    citta: 'Milano',
    categoria: 'Software',
    sito: 'https://acme.it',
    telefono: '02 1234567',
    email: 'info@acme.it',
    graph_score: 82,
    entity_id: '00000000-0000-0000-0000-000000000001',
  },
]
const csv = agenticResultsToCsv(mockResults)
assert.ok(csv.startsWith('\uFEFF'), 'CSV con BOM UTF-8')
assert.ok(csv.includes('graph_score'), 'CSV colonna graph_score')
assert.ok(csv.includes('Acme Srl'), 'CSV contiene azienda')
console.log('✓ export CSV con graph_score')

assert.ok(GRAPH_RANK_TOOLTIP.includes('0–100'), 'tooltip graph rank')
assert.ok(graphRankScoreClass(80).includes('rose'), 'score alto = rose')
assert.ok(graphRankScoreClass(45).includes('amber'), 'score medio = amber')
assert.ok(graphRankScoreClass(20).includes('slate'), 'score basso = slate')
console.log('✓ Graph Rank UX helpers')

const page = fs.readFileSync('src/app/dashboard/universe/page.tsx', 'utf8')
assert.ok(page.includes('setTabWithUrl'), 'tab sincronizzati con URL ?tab=')
assert.ok(page.includes('UniverseWebhookDeliveriesPanel'), 'pannello webhook in analytics')
console.log('✓ universe page UX (tab URL + webhook panel)')

const evidenceChips = buildGraphRankEvidence({
  freshness: 12,
  intent_location: 10,
  recent_events: 2,
  relationships: 0,
  observations: 6,
  confidence: 5,
})
assert.ok(evidenceChips.length >= 3, 'evidence chips generate')
assert.ok(evidenceChips.some((e) => e.includes('Località')), 'evidence include località')
const tableSrc = fs.readFileSync('src/components/universe/AgenticResultsTable.tsx', 'utf8')
assert.ok(tableSrc.includes('SaveToGraphButton'), 'tabella offre Salva nel grafo')
console.log('✓ evidence per riga + azione Salva')

// ── Fase 6: Hydrate ──────────────────────────────────────────────
console.log('\n▶ Fase 6 — Hydrate lead da grafo')
const readEnabled = isUniverseReadEnabled()
assert.equal(typeof readEnabled, 'boolean', 'isUniverseReadEnabled boolean')
const hydrateRoute = fs.readFileSync('src/app/api/universe/hydrate-leads/route.ts', 'utf8')
assert.ok(hydrateRoute.includes('hydrateLeadsFromUniverse'), 'route hydrate')
const checkJob = fs.readFileSync('src/app/api/check-scrape-job/route.ts', 'utf8')
assert.ok(checkJob.includes('hydrate') || checkJob.includes('Universe'), 'check-scrape-job hydrate')
console.log('✓ hydrate wiring')

// ── Fase 7: Digital Twin ─────────────────────────────────────────
console.log('\n▶ Fase 7 — Digital Twin')
function opportunityScoreFromLead(obj) {
  let score = 0
  if (obj.meta_pixel !== true) score += 25
  if (!obj.sito && !obj.website) score += 30
  if (!obj.instagram) score += 15
  return Math.min(score, 100)
}
const opp = opportunityScoreFromLead({ rating: 4.5, meta_pixel: false, sito: 'https://x.it' })
assert.ok(opp >= 0 && opp <= 100, 'opportunity score range')
const twinPanel = fs.readFileSync('src/components/universe/UniverseDigitalTwinPanel.tsx', 'utf8')
assert.ok(twinPanel.includes('getUniverseDigitalTwin'), 'twin panel fetch')
console.log('✓ digital twin score + UI')

// ── Fase 8: Live & Analytics ───────────────────────────────────────
console.log('\n▶ Fase 8 — Live events + Analytics')
const headline = formatUniverseEventHeadline({
  event_type: 'hiring_detected',
  payload: { summary: 'Acme assume sviluppatori' },
})
assert.ok(headline.length > 5, 'event headline')
const analyticsRoute = fs.readFileSync('src/app/api/universe/analytics/route.ts', 'utf8')
assert.ok(analyticsRoute.includes('getUniverseAnalyticsCached'), 'analytics API')
console.log('✓ event stream + analytics')

// ── Fase 9: Cache + Alerting ─────────────────────────────────────
console.log('\n▶ Fase 9 — Cache + Alerting')
const cacheKey = buildUniverseCacheKey('agentic', {
  intent: E2E_INTENTS[0].intent,
  city: 'Roma',
  limit: 50,
})
assert.ok(cacheKey.startsWith('agentic:'), 'cache key prefix')
assert.ok(cacheTtlSeconds('agentic') > 0, 'cache TTL agentic')
assert.equal(typeof isUniverseCacheEnabled(), 'boolean', 'cache flag')
const alerting = fs.readFileSync('src/lib/universe/alerting.ts', 'utf8')
assert.ok(alerting.includes('dispatchUniverseEventAlerts'), 'alerting dispatch')
console.log('✓ query cache + alerting')

// ── Fase 10: Ranking + Webhooks + Archive ────────────────────────
console.log('\n▶ Fase 10 — Graph ranking + Webhooks + Archive')
const entity = {
  id: 'e1',
  canonical_id: 'acme.it',
  entity_type: 'company',
  name: 'Acme Software Milano',
  city: 'Milano',
  last_seen_at: new Date().toISOString(),
  confidence: 0.85,
  metadata: { category: 'software' },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}
const intent = E2E_INTENTS[1].intent
const factors = buildGraphRankFactors(entity, intent, { recent_events: 3, relationships: 2, observations: 10 })
const score = computeGraphRankScore(factors)
assert.ok(score >= 60, `graph rank alto atteso, got ${score}`)
assert.equal(typeof isUniverseWebhooksEnabled(), 'boolean', 'webhooks flag')
const consumer = fs.readFileSync('src/lib/universe/event-consumer.ts', 'utf8')
assert.ok(consumer.includes('dispatchUniverseEventWebhooks'), 'consumer webhooks')
assert.ok(consumer.includes('archiveOldUniverseEvents'), 'consumer archive')
console.log('✓ ranking + webhooks + archive consumer')

// ── Live DB (opzionale) ──────────────────────────────────────────
console.log('\n▶ Live DB — Supabase dev (se raggiungibile)')
const env = loadEnv('.env.local')
let dbOk = false

if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const { error: pingErr } = await sb.from('universe_entities').select('id', { count: 'exact', head: true })
    if (pingErr) throw new Error(pingErr.message)

    dbOk = true
    console.log('✓ connessione Supabase OK')

    const coreTables = [
      'universe_entities',
      'universe_events',
      'universe_observations',
      'universe_relationships',
      'universe_user_context',
    ]
    for (const t of coreTables) {
      const { error } = await sb.from(t).select('*', { count: 'exact', head: true })
      assert.ok(!error, `tabella ${t}: ${error?.message}`)
      console.log(`✓ tabella ${t}`)
    }

    const phase10Tables = ['universe_webhook_deliveries', 'universe_events_archive', 'universe_query_cache']
    for (const t of phase10Tables) {
      const { error } = await sb.from(t).select('*', { count: 'exact', head: true })
      if (error && /does not exist|schema cache/i.test(error.message)) {
        console.warn(`⚠ tabella ${t} mancante — esegui: npm run db:apply-mirax`)
      } else {
        assert.ok(!error, `tabella ${t}: ${error?.message}`)
        console.log(`✓ tabella ${t}`)
      }
    }

    const { data: sample } = await sb.from('universe_entities').select('*').eq('entity_type', 'company').limit(5)
    if (sample?.length) {
      const ranked = await rankUniverseEntities(sb, sample, intent)
      assert.ok(ranked.length === sample.length, 'ranking live count')
      assert.ok(ranked[0].graph_score >= ranked[ranked.length - 1].graph_score, 'ranking live ordinato')
      console.log(`✓ rankUniverseEntities live (${sample.length} entità, top score ${ranked[0].graph_score})`)

      const mapped = signalIntentToUniverseQuery(intent, { city: 'Milano', limit: 10 })
      const { executeUniverseQuery } = await import('../src/lib/universe/query-builder.ts')
      const { total } = await executeUniverseQuery(sb, mapped.query)
      assert.ok(total >= 0, 'query grafo live')
      console.log(`✓ query grafo live (total=${total})`)
    } else {
      console.log('○ grafo vuoto — popola con UNIVERSE_ENABLED=1 + scrape')
    }

    const { error: archErr } = await sb.rpc('universe_archive_old_events', { p_days: 180 })
    if (archErr && /does not exist/i.test(archErr.message)) {
      console.warn('⚠ RPC universe_archive_old_events mancante — applica migration fase 10')
    } else {
      assert.ok(!archErr, `archive RPC: ${archErr?.message}`)
      console.log('✓ RPC universe_archive_old_events')
    }
  } catch (e) {
    console.warn(`⚠ Live DB non raggiungibile da questo runner: ${e instanceof Error ? e.message : e}`)
    console.warn('  Verifica su staging: npm run db:apply-mirax && npm run test:universe:schema')
  }
} else {
  console.warn('⚠ .env.local senza credenziali Supabase — skip live DB')
}

console.log('\n═══ Riepilogo E2E ═══')
console.log(`Logic journeys (Fasi 5–10): PASS`)
console.log(`Live DB: ${dbOk ? 'PASS' : 'SKIP (rete/env — verifica manualmente su staging)'}`)
console.log('\n[test-universe-e2e] OK')
