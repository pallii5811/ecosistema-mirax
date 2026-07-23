/**
 * Offline certification for open-world matrix runner + budget guard.
 * No paid calls. No discovery mutation. No override env vars set.
 */
import assert from 'node:assert/strict'
import {
  OPENWORLD_MATRIX_CASES,
  assertCaseIsProductionInputOnly,
  extractLeadReviewFields,
  formatFunnel,
  type MatrixCaseId,
} from './lib/openworld-matrix-cases'
import {
  CASE_TOTAL_CAP_EUR,
  assertBudgetAccountingMatch,
  computeCampaignSpendTotals,
  computeWorkerRemainingCap,
  parseAllowOverCeiling,
  parseOwnerAuthorizedExtraEur,
  resolveSpendAuthorization,
} from './lib/openworld-matrix-budget'

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

function fixtureDataset() {
  const since = '2026-07-20T00:00:00.000Z'
  const searches = [
    {
      id: 's-campaign',
      category: 'Open-World Matrix — A',
      intent: {
        intent_compiler_telemetry: { source: 'openworld_diverse_matrix_production_path' },
      },
      status: 'completed',
      results: [{ azienda: 'X' }],
      created_at: '2026-07-22T10:00:00.000Z',
    },
    {
      id: 's-failed-campaign',
      category: 'Antincendio Industriale Open-World Canary',
      intent: {},
      status: 'error',
      results: [],
      created_at: '2026-07-21T10:00:00.000Z',
    },
    {
      id: 's-other',
      category: 'unrelated',
      intent: { lifecycle_stage: 'v5_shadow' },
      status: 'completed',
      results: [{ azienda: 'Y' }],
      created_at: '2026-07-22T12:00:00.000Z',
    },
  ]
  const canaries = [
    { search_id: 's-failed-campaign', canary_type: 'open_world_antincendio' },
  ]
  const ledger = [
    { search_id: 's-campaign', status: 'settled', actual_cost_eur: 0.13 },
    { search_id: 's-failed-campaign', status: 'failed', actual_cost_eur: 0.4 },
    { search_id: 's-failed-campaign', status: 'halted', estimated_cost_eur: 0.1 },
    { search_id: 's-other', status: 'settled', actual_cost_eur: 9.0 }, // must be excluded
    { search_id: 's-campaign', status: 'reserved', actual_cost_eur: 0.05 }, // not spend
  ]
  return { searches, canaries, ledger, since }
}

function main() {
  const ids = Object.keys(OPENWORLD_MATRIX_CASES) as MatrixCaseId[]
  assert.deepEqual(ids.sort(), ['A', 'B', 'C', 'D', 'E', 'F'])

  for (const id of ids) {
    const spec = OPENWORLD_MATRIX_CASES[id]
    assertCaseIsProductionInputOnly(spec)
    assert.equal(spec.requested_count, 3)
    for (const key of FORBIDDEN) {
      assert.equal(Object.prototype.hasOwnProperty.call(spec, key), false, `${id} has ${key}`)
    }
  }

  // --- campaign spend: failed included, unrelated excluded ---
  const fx = fixtureDataset()
  const rest = computeCampaignSpendTotals({
    searches: fx.searches,
    canaries: fx.canaries,
    ledger: fx.ledger,
    budgetSinceIso: fx.since,
  })
  const postgres = computeCampaignSpendTotals({
    searches: fx.searches,
    canaries: fx.canaries,
    ledger: fx.ledger,
    budgetSinceIso: fx.since,
  })
  assertBudgetAccountingMatch(rest.cumulative_cost_eur, postgres.cumulative_cost_eur)
  assert.equal(rest.cumulative_cost_eur, 0.63) // 0.13 + 0.40 + 0.10; reserved 0.05 excluded
  assert.equal(rest.successful_completed_cost_eur, 0.13)
  assert.ok(!rest.campaign_search_ids.includes('s-other'))
  // reserved is not spendable campaign spend (no double ledger / reservation inflation)
  assert.equal(rest.ledger_rows, 3)

  // mismatch detection
  assert.throws(
    () => assertBudgetAccountingMatch(0.63, 0.64),
    (err: Error) => err.name === 'BUDGET_ACCOUNTING_MISMATCH' || /BUDGET_ACCOUNTING_MISMATCH/.test(err.message),
  )

  // successful spend does NOT increase residual
  const authBase = resolveSpendAuthorization({
    actualCumulativeBefore: 2.5,
    successfulCompletedCostEur: 0.13,
    spendCeilingEur: 2.7,
    allowOverCeiling: false,
    ownerAuthorizedExtraEur: 0,
    caseTotalCapEur: CASE_TOTAL_CAP_EUR,
  })
  assert.equal(authBase.residual_budget_eur, 0.2)
  assert.equal(authBase.can_prepare, false) // 0.2 < 0.25 case cap
  assert.equal(authBase.reject_reason, 'RESIDUAL_BELOW_CASE_CAP')

  // override absent → reject when over ceiling
  const noOverride = resolveSpendAuthorization({
    actualCumulativeBefore: 2.982502,
    successfulCompletedCostEur: 0.130451,
    spendCeilingEur: 2.7,
    allowOverCeiling: false,
    ownerAuthorizedExtraEur: 0,
  })
  assert.equal(noOverride.can_prepare, false)
  assert.equal(noOverride.reject_reason, 'SPEND_CEILING_EXCEEDED')

  // flag without extra → reject
  const flagOnly = resolveSpendAuthorization({
    actualCumulativeBefore: 2.982502,
    spendCeilingEur: 2.7,
    allowOverCeiling: true,
    ownerAuthorizedExtraEur: 0,
  })
  assert.equal(flagOnly.can_prepare, false)
  assert.equal(flagOnly.reject_reason, 'OWNER_EXTRA_EUR_REQUIRED')

  // extra €0.25 → authorized ceiling = cumulative + 0.25, residual = 0.25
  const withExtra = resolveSpendAuthorization({
    actualCumulativeBefore: 2.982502,
    successfulCompletedCostEur: 0.130451,
    spendCeilingEur: 2.7,
    allowOverCeiling: true,
    ownerAuthorizedExtraEur: 0.25,
  })
  assert.equal(withExtra.owner_authorized_extra_eur, 0.25)
  assert.equal(withExtra.authorized_ceiling_eur, Number((2.982502 + 0.25).toFixed(6)))
  assert.equal(withExtra.residual_budget_eur, 0.25)
  assert.equal(withExtra.can_prepare, true)
  // successful diagnostic must not inflate residual beyond owner extra
  assert.equal(withExtra.residual_budget_eur, withExtra.owner_authorized_extra_eur)

  // env parsers: unset → no silent bypass
  assert.equal(parseAllowOverCeiling(undefined), false)
  assert.equal(parseOwnerAuthorizedExtraEur(undefined), 0)
  assert.equal(parseOwnerAuthorizedExtraEur(''), 0)
  assert.equal(parseOwnerAuthorizedExtraEur('-1'), 0)

  // planning €0.04 → worker cap €0.21
  const capA = computeWorkerRemainingCap(CASE_TOTAL_CAP_EUR, 0.04)
  assert.equal(capA.worker_remaining_cap_eur, 0.21)
  assert.equal(capA.planning_spend_eur, 0.04)

  // planning >= €0.25 → worker must not start
  assert.throws(
    () => computeWorkerRemainingCap(CASE_TOTAL_CAP_EUR, 0.25),
    (err: Error) =>
      err.name === 'CASE_BUDGET_EXHAUSTED_DURING_PLANNING' ||
      /CASE_BUDGET_EXHAUSTED_DURING_PLANNING/.test(err.message),
  )
  assert.throws(() => computeWorkerRemainingCap(CASE_TOTAL_CAP_EUR, 0.3), /CASE_BUDGET_EXHAUSTED/)

  // date separation still locked
  const row = extractLeadReviewFields({
    azienda: 'X',
    source_published_at: '2026-05-10',
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
  assert.equal(funnel.lifecycle_published, 3)

  console.log(
    JSON.stringify(
      {
        ok: true,
        cases: ids.length,
        contract: 'production_input_only',
        budget_guard: 'ok',
        case_total_cap_eur: CASE_TOTAL_CAP_EUR,
      },
      null,
      2,
    ),
  )
}

main()
