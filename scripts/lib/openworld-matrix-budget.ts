/**
 * Authoritative open-world matrix budget accounting (pure + dual-source).
 * Campaign-scoped only — never the whole search_cost_ledger.
 */

export const LEDGER_SPEND_STATUSES = ['settled', 'committed', 'failed', 'halted'] as const
export const CASE_TOTAL_CAP_EUR = 0.25
export const MATRIX_TELEMETRY_SOURCE = 'openworld_diverse_matrix_production_path'

export type SearchBudgetRow = {
  id: string
  category?: string | null
  intent?: Record<string, unknown> | null
  status?: string | null
  results?: unknown
  created_at?: string | null
}

export type CanaryBudgetRow = {
  search_id: string
  canary_type?: string | null
}

export type LedgerBudgetRow = {
  search_id: string
  actual_cost_eur?: number | null
  estimated_cost_eur?: number | null
  status?: string | null
}

export type BudgetAuthorizationInput = {
  actualCumulativeBefore: number
  spendCeilingEur: number
  allowOverCeiling: boolean
  ownerAuthorizedExtraEur: number
  caseTotalCapEur?: number
}

export type BudgetAuthorization = {
  actual_cumulative_before: number
  successful_completed_cost_eur: number
  spend_ceiling_eur: number
  owner_authorized_extra_eur: number
  authorized_ceiling_eur: number
  residual_budget_eur: number
  case_total_cap_eur: number
  can_prepare: boolean
  reject_reason: string | null
  allow_over_ceiling: boolean
}

export type CampaignSpendTotals = {
  cumulative_cost_eur: number
  successful_completed_cost_eur: number
  ledger_rows: number
  campaign_search_ids: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function ledgerRowCost(row: Pick<LedgerBudgetRow, 'actual_cost_eur' | 'estimated_cost_eur'>): number {
  return Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0) || 0
}

export function isSpendStatus(status: string | null | undefined): boolean {
  return LEDGER_SPEND_STATUSES.includes(String(status || '') as (typeof LEDGER_SPEND_STATUSES)[number])
}

/** Shared campaign membership — used by both REST and Postgres paths. */
export function isOpenWorldCampaignSearch(
  search: SearchBudgetRow,
  canaryTypes: string[],
  budgetSinceIso: string,
): boolean {
  const created = search.created_at ? Date.parse(search.created_at) : NaN
  const since = Date.parse(budgetSinceIso)
  if (Number.isFinite(since) && Number.isFinite(created) && created < since) return false

  const intent = asRecord(search.intent) || {}
  const telemetry = asRecord(intent.intent_compiler_telemetry) || {}
  if (String(telemetry.source || '') === MATRIX_TELEMETRY_SOURCE) return true

  const category = String(search.category || '')
  if (/open-world/i.test(category)) return true

  return canaryTypes.some(
    (t) => /^open_world/i.test(t) || /openworld/i.test(t),
  )
}

export function computeCampaignSpendTotals(input: {
  searches: SearchBudgetRow[]
  canaries: CanaryBudgetRow[]
  ledger: LedgerBudgetRow[]
  budgetSinceIso: string
}): CampaignSpendTotals {
  const canariesBySearch = new Map<string, string[]>()
  for (const row of input.canaries) {
    const id = String(row.search_id || '')
    if (!id) continue
    const list = canariesBySearch.get(id) || []
    if (row.canary_type) list.push(String(row.canary_type))
    canariesBySearch.set(id, list)
  }

  const campaignIds = new Set<string>()
  const successfulIds = new Set<string>()
  for (const search of input.searches) {
    const types = canariesBySearch.get(search.id) || []
    if (!isOpenWorldCampaignSearch(search, types, input.budgetSinceIso)) continue
    campaignIds.add(search.id)
    const results = search.results
    if (
      search.status === 'completed' &&
      Array.isArray(results) &&
      results.length >= 1
    ) {
      successfulIds.add(search.id)
    }
  }

  let cumulative = 0
  let successful = 0
  let ledgerRows = 0
  for (const row of input.ledger) {
    if (!isSpendStatus(row.status)) continue
    const sid = String(row.search_id || '')
    if (!campaignIds.has(sid)) continue
    const cost = ledgerRowCost(row)
    cumulative += cost
    ledgerRows += 1
    if (successfulIds.has(sid)) successful += cost
  }

  return {
    cumulative_cost_eur: Number(cumulative.toFixed(6)),
    successful_completed_cost_eur: Number(successful.toFixed(6)),
    ledger_rows: ledgerRows,
    campaign_search_ids: [...campaignIds].sort(),
  }
}

/**
 * Authorized ceiling = base ceiling, or cumulative_before + owner extra when
 * BOTH allow flag and positive extra EUR are present. Failed spend stays counted.
 */
export function resolveSpendAuthorization(
  input: BudgetAuthorizationInput & { successfulCompletedCostEur?: number },
): BudgetAuthorization {
  const caseCap = Number(input.caseTotalCapEur ?? CASE_TOTAL_CAP_EUR)
  const cumulative = Number(input.actualCumulativeBefore) || 0
  const successful = Number(input.successfulCompletedCostEur ?? 0) || 0
  const baseCeiling = Number(input.spendCeilingEur) || 0
  const allowOver = input.allowOverCeiling === true
  const extra = Number(input.ownerAuthorizedExtraEur)
  const extraOk = Number.isFinite(extra) && extra > 0

  let authorizedCeiling = baseCeiling
  let reject: string | null = null

  const withinBaseCeiling = cumulative <= baseCeiling + 1e-9
  if (withinBaseCeiling) {
    authorizedCeiling = baseCeiling
  } else if (allowOver && extraOk) {
    // New authorized limit is cumulative_before + owner extra (not a silent raise).
    authorizedCeiling = cumulative + extra
  } else if (allowOver && !extraOk) {
    reject = 'OWNER_EXTRA_EUR_REQUIRED'
  } else {
    reject = 'SPEND_CEILING_EXCEEDED'
  }

  const residual = Math.max(0, authorizedCeiling - cumulative)
  // Successful-only spend is diagnostic and must NOT increase residual.
  let canPrepare = reject == null && residual + 1e-9 >= caseCap
  if (!canPrepare && reject == null) {
    reject = 'RESIDUAL_BELOW_CASE_CAP'
  }

  return {
    actual_cumulative_before: Number(cumulative.toFixed(6)),
    successful_completed_cost_eur: Number(successful.toFixed(6)),
    spend_ceiling_eur: Number(baseCeiling.toFixed(6)),
    owner_authorized_extra_eur: extraOk ? Number(extra.toFixed(6)) : 0,
    authorized_ceiling_eur: Number(authorizedCeiling.toFixed(6)),
    residual_budget_eur: Number(residual.toFixed(6)),
    case_total_cap_eur: caseCap,
    can_prepare: canPrepare,
    reject_reason: canPrepare ? null : reject,
    allow_over_ceiling: allowOver && extraOk,
  }
}

/** CASE_TOTAL_CAP includes planning; worker may only spend the remainder. */
export function computeWorkerRemainingCap(
  caseTotalCapEur: number,
  planningSpendEur: number,
): { worker_remaining_cap_eur: number; planning_spend_eur: number } {
  const planning = Math.max(0, Number(planningSpendEur) || 0)
  const cap = Number(caseTotalCapEur) || 0
  if (planning + 1e-9 >= cap) {
    const err = new Error('CASE_BUDGET_EXHAUSTED_DURING_PLANNING')
    err.name = 'CASE_BUDGET_EXHAUSTED_DURING_PLANNING'
    throw err
  }
  return {
    planning_spend_eur: Number(planning.toFixed(6)),
    worker_remaining_cap_eur: Number(Math.max(0, cap - planning).toFixed(6)),
  }
}

export function assertBudgetAccountingMatch(
  restCumulative: number,
  postgresCumulative: number,
  epsilon = 1e-6,
): void {
  if (Math.abs(Number(restCumulative) - Number(postgresCumulative)) > epsilon) {
    const err = new Error(
      `BUDGET_ACCOUNTING_MISMATCH rest=${restCumulative} postgres=${postgresCumulative}`,
    )
    err.name = 'BUDGET_ACCOUNTING_MISMATCH'
    throw err
  }
}

export function parseOwnerAuthorizedExtraEur(raw: string | undefined): number {
  const n = Number(String(raw ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function parseAllowOverCeiling(raw: string | undefined): boolean {
  return String(raw ?? '').trim() === '1'
}
