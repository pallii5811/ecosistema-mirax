import assert from 'node:assert/strict'
import fs from 'node:fs'

import { compileCommercialSearchPlan } from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { canonicalSignalId } from '../src/lib/signal-ontology/ontology'
import { sourceSupportsSignal } from '../src/lib/source-intelligence/registry'
import { canonicalPlanToLegacy } from '../src/lib/uqe/mirax-query-planner'

const base = JSON.parse(fs.readFileSync('contracts/fixtures/commercial-search-plan.valid.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('evaluation/canary-v1/manifest.json', 'utf8')) as {
  canaries: Array<{ vertical: string; query: string; expected_signal_any: string[] }>
}
const priorKey = process.env.ANTHROPIC_API_KEY
const priorFetch = globalThis.fetch
process.env.ANTHROPIC_API_KEY = 'offline-test-only'

let activePayload: Record<string, unknown> = {}
globalThis.fetch = async () => new Response(JSON.stringify({
  usage: { input_tokens: 80, output_tokens: 40 },
  content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: activePayload }],
}), { status: 200, headers: { 'content-type': 'application/json' } })

const meter = {
  async reserve() { return { status: 'reserved' } },
  async settle() { return { status: 'settled' } },
  async release() { throw new Error('no provider failure expected') },
}

async function main() {
try {
  for (const [index, spec] of manifest.canaries.entries()) {
    const signal = canonicalSignalId(spec.expected_signal_any[0]) || spec.expected_signal_any[0]
    activePayload = structuredClone(base)
    ;(activePayload as any).seller = {
      offer_category: spec.vertical,
      offer_description: `Servizi B2B della verticale ${spec.vertical}`,
      products_or_services: [`servizio ${spec.vertical}`],
      problems_solved: [`problema operativo ${spec.vertical}`],
      sales_motion: 'consultative_outbound',
      preferred_buyer_roles: ['titolare', 'responsabile funzione'],
    }
    ;(activePayload as any).commercial_hypotheses = []
    ;(activePayload as any).signal_policy.required_signals = [signal]
    ;(activePayload as any).signal_policy.optional_signals = []
    ;(activePayload as any).signal_policy.maximum_age_days_by_signal = {}
    ;(activePayload as any).source_policy.allowed_source_classes = []
    ;(activePayload as any).source_policy.preferred_source_classes = []
    const plan = await compileCommercialSearchPlan(spec.query, {
      searchId: `00000000-0000-0000-0000-${String(index + 10).padStart(12, '0')}`,
      requestedLeadCount: 5,
      costMeter: meter,
      allowRepair: false,
    })
    assert.ok(plan, `${spec.vertical}: canonical plan must pass`)
    const hypothesis = plan.commercial_hypotheses.find((item) => item.signals.includes(signal))
    assert.ok(hypothesis, `${spec.vertical}: hypothesis for ${signal}`)
    assert.ok(hypothesis.triggering_events.length > 0, `${spec.vertical}: triggering event`)
    assert.ok(hypothesis.buyer_problem.length >= 12, `${spec.vertical}: buyer problem`)
    assert.ok(hypothesis.implied_need.length >= 12, `${spec.vertical}: implied need`)
    assert.ok(hypothesis.relevance_to_offer.length >= 12, `${spec.vertical}: offer relevance`)
    assert.ok(
      plan.source_policy.allowed_source_classes.some((source) => sourceSupportsSignal(source, signal)),
      `${spec.vertical}: compatible source`,
    )
    const executable = canonicalPlanToLegacy(plan)
    const sourcePlan = executable.source_plan || []
    assert.ok(sourcePlan.length > 0, `${spec.vertical}: executable source plan`)
    assert.ok(
      sourcePlan.every((lane) => lane.query_templates.length > 0 && lane.query_templates.every(Boolean)),
      `${spec.vertical}: no empty source query templates`,
    )
    assert.ok(
      sourcePlan.every((lane) => lane.expected_evidence.length > 0 && lane.expected_evidence.every((expected) =>
        lane.source_types.some((source) => sourceSupportsSignal(source, expected)))),
      `${spec.vertical}: every executable lane must carry only source-compatible evidence`,
    )
    assert.ok(
      plan.signal_policy.required_signals.every((required) => sourcePlan.some((lane) =>
        lane.expected_evidence.includes(required) &&
        lane.source_types.some((source) => sourceSupportsSignal(source, required)))),
      `${spec.vertical}: every required signal must have an executable compatible source lane`,
    )
    if (spec.vertical === 'solar_energy') {
      const templates = sourcePlan.flatMap((lane) => lane.query_templates).join(' ')
      assert.doesNotMatch(templates, /appalto|gara aggiudicata|contratto affidato/i,
        'solar_energy: production expansion must never degrade to procurement')
      assert.match(templates, /ampliamento|stabilimento|impianto|capacit[aà] produttiva/i,
        'solar_energy: source queries must preserve the production-expansion signal')
      const municipal = sourcePlan.find((lane) => lane.source_types.includes('municipal_register'))
      if (municipal) assert.equal(municipal.lane, 'regulatory',
        'solar_energy: municipal register must use the regulatory/permit lane')
    }
  }
  console.log(`High-value compiler matrix: ${manifest.canaries.length}/10 verticals PASS without repair`)
} finally {
  globalThis.fetch = priorFetch
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = priorKey
}
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
