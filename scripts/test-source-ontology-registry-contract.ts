import assert from 'node:assert/strict'
import fs from 'node:fs'

import { SIGNAL_ALIASES, SIGNAL_ONTOLOGY } from '../src/lib/signal-ontology/ontology'
import { SOURCE_BY_ID, sourceSupportsSignal } from '../src/lib/source-intelligence/registry'
import { buildHeuristicMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'

const fixture = JSON.parse(
  fs.readFileSync('evaluation/fixtures/workplace-safety-incomplete-source-coverage-20260713.json', 'utf8'),
) as { query: string; required_signals: string[] }

function registrySupportsOntologySignal(sourceId: string, ontologySignalId: string): boolean {
  if (sourceSupportsSignal(sourceId, ontologySignalId)) return true
  const legacyAliases = Object.entries(SIGNAL_ALIASES)
    .filter(([, canonical]) => canonical === ontologySignalId)
    .map(([alias]) => alias)
  return legacyAliases.some((alias) => sourceSupportsSignal(sourceId, alias))
}

for (const signal of SIGNAL_ONTOLOGY) {
  for (const sourceId of [...new Set([...signal.likelySourceClasses, ...signal.preferredSourceClasses])]) {
    assert.ok(
      SOURCE_BY_ID.has(sourceId),
      `ontology signal ${signal.id} references missing registry source ${sourceId}`,
    )
  }
}

for (const signalId of ['production_expansion', 'new_location', 'regulatory_change', 'certification'] as const) {
  assert.ok(
    registrySupportsOntologySignal('municipal_register', signalId),
    `municipal_register must support ontology signal ${signalId}`,
  )
}

for (const signalId of fixture.required_signals) {
  const signal = SIGNAL_ONTOLOGY.find((entry) => entry.id === signalId)
  assert.ok(signal, `fixture signal ${signalId} must exist in ontology`)
  const viable = signal.preferredSourceClasses.filter((sourceId) =>
    registrySupportsOntologySignal(sourceId, signal.id),
  )
  assert.ok(viable.length > 0, `fixture signal ${signalId} must have at least one viable preferred source`)
}

const workplacePlan = buildHeuristicMiraxQueryPlan(fixture.query)
for (const lane of workplacePlan.source_plan || []) {
  for (const sourceId of lane.source_types) {
    assert.ok(SOURCE_BY_ID.has(sourceId), `workplace lane ${lane.lane} references unknown source class ${sourceId}`)
  }
  assert.ok(lane.query_templates.length > 0, `workplace lane ${lane.lane} must have query templates`)
  assert.ok(
    lane.query_templates.every((template) => template.trim().length > 12),
    `workplace lane ${lane.lane} must not use empty query templates`,
  )
  for (const evidence of lane.expected_evidence) {
    assert.ok(
      lane.source_types.some((sourceId) => sourceSupportsSignal(sourceId, evidence)),
      `workplace lane ${lane.lane} assigns incompatible evidence ${evidence}`,
    )
  }
}

assert.ok(
  workplacePlan.source_plan?.some((lane) =>
    lane.lane === 'regulatory' &&
    lane.source_types.includes('municipal_register') &&
    lane.expected_evidence.includes('production_expansion'),
  ),
  'workplace evaluation plan must expose municipal_register on the regulatory lane for production_expansion',
)

console.log(
  `Source ontology/registry contract: ${SIGNAL_ONTOLOGY.length} ontology signals, ${SOURCE_BY_ID.size} registry sources, municipal_register alignment OK`,
)
