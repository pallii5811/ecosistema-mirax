/**
 * Offline certification for open-world matrix runner contracts.
 * No paid calls. No discovery mutation.
 */
import assert from 'node:assert/strict'
import {
  OPENWORLD_MATRIX_CASES,
  assertCaseIsProductionInputOnly,
  extractLeadReviewFields,
  formatFunnel,
  type MatrixCaseId,
} from './lib/openworld-matrix-cases'

const FORBIDDEN = [
  'seller',
  'target',
  'required_signals',
  'preferred_adapters',
  'adapters',
  'required_attributes',
  'excluded_roles',
  'canonical_plan',
  'hypotheses',
  'signals',
]

function main() {
  const ids = Object.keys(OPENWORLD_MATRIX_CASES) as MatrixCaseId[]
  assert.deepEqual(ids.sort(), ['A', 'B', 'C', 'D', 'E', 'F'])

  for (const id of ids) {
    const spec = OPENWORLD_MATRIX_CASES[id]
    assertCaseIsProductionInputOnly(spec)
    assert.equal(spec.requested_count, 3)
    assert.ok(spec.raw_query.length > 40)
    for (const key of FORBIDDEN) {
      assert.equal(Object.prototype.hasOwnProperty.call(spec, key), false, `${id} has ${key}`)
    }
  }

  // Case A must be seller-driven inferred need language (not explicit "cercano CRM")
  assert.match(OPENWORLD_MATRIX_CASES.A.raw_query, /manutenzione predittiva/i)
  assert.match(OPENWORLD_MATRIX_CASES.A.raw_query, /ampliato|automatizzato|macchinari/i)

  // Case B explicit CRM demand + exclusions
  assert.match(OPENWORLD_MATRIX_CASES.B.raw_query, /valutando|selezionando|cercando un CRM/i)
  assert.match(OPENWORLD_MATRIX_CASES.B.raw_query, /Escludi vendor CRM/i)

  // Case F local — no invented event requirement in text beyond local targets
  assert.match(OPENWORLD_MATRIX_CASES.F.raw_query, /Trento/i)
  assert.match(OPENWORLD_MATRIX_CASES.F.raw_query, /hotel|ristoranti|ricettive/i)

  // Date field separation in review formatter
  const row = extractLeadReviewFields({
    azienda: 'X',
    source_published_at: '2026-05-10',
    // event_date intentionally absent
  })
  assert.equal(row.event_date, '')
  assert.equal(row.source_published_at, '2026-05-10')

  const funnel = formatFunnel(
    {
      cumulative_raw_unique: 50,
      universal_prefilter_telemetry: { prefilter_accepted: 12, prefilter_rejected: 38 },
      acquisition: { pages_fetched: 12, provider_queries: 4 },
      qualified: 3,
    },
    3,
    5,
  )
  assert.equal(funnel.serp_raw, 50)
  assert.equal(funnel.prefilter_accepted, 12)
  assert.equal(funnel.fetched, 12)
  assert.equal(funnel.candidates, 5)
  assert.equal(funnel.lifecycle_published, 3)

  console.log(JSON.stringify({ ok: true, cases: ids.length, contract: 'production_input_only' }, null, 2))
}

main()
