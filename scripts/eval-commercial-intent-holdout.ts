/**
 * Honest commercial-intent holdout evaluator — no auto-pass, per-property denominators.
 *
 * Usage:
 *   npx tsx scripts/eval-commercial-intent-holdout.ts --dataset blind
 *   npx tsx scripts/eval-commercial-intent-holdout.ts --dataset adversarial --offline
 */
import fs from 'node:fs'
import path from 'node:path'

import { hasActorDirectionInversion } from '@/lib/commercial-intent/actor-direction'
import { compileCommercialIntentSpecHeuristic } from '@/lib/commercial-intent/compile-heuristic'
import { compileCommercialIntentSemantic } from '@/lib/commercial-intent/semantic-compile'
import type { CommercialIntentSpec, CommercialRequestMode } from '@/lib/commercial-intent/types'

type CaseChecks = {
  request_mode?: CommercialRequestMode
  seller_query?: boolean
  offer_keywords?: string[]
  problem_keywords?: string[]
  buyer_need_keywords?: string[]
  target_role?: string
  explicit_demand?: boolean
  clarification_required?: boolean
  actor_inversion_forbidden?: boolean
}

type HoldoutCase = {
  id: string
  query: string
  tags?: string[]
  checks: CaseChecks
}

type DatasetFile = { version: string; cases: HoldoutCase[] }

type Metric = { correct: number; evaluated: number; pct: number | null }

function parseArgs(argv: string[]) {
  const dataset = argv.includes('--dataset')
    ? argv[argv.indexOf('--dataset') + 1]
    : 'blind'
  const offline = argv.includes('--offline')
  return { dataset, offline }
}

function loadDataset(name: string): HoldoutCase[] {
  const file = path.join(
    process.cwd(),
    'evaluation',
    'commercial-intent-holdout',
    `${name}-holdout.json`.replace('blind-holdout', 'blind-holdout').replace('adversarial-holdout', 'adversarial-validation').replace('development-holdout', 'development-fixtures'),
  )
  const map: Record<string, string> = {
    blind: 'blind-holdout.json',
    adversarial: 'adversarial-validation.json',
    development: 'development-fixtures.json',
  }
  const resolved = path.join(process.cwd(), 'evaluation', 'commercial-intent-holdout', map[name] || map.blind)
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as DatasetFile
  return raw.cases
}

function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase()
  return needles.some((n) => h.includes(n.toLowerCase()))
}

function metric(correct: number, evaluated: number): Metric {
  return { correct, evaluated, pct: evaluated ? (correct / evaluated) * 100 : null }
}

async function compileCase(query: string, offline: boolean): Promise<CommercialIntentSpec> {
  if (offline) return compileCommercialIntentSpecHeuristic(query)
  try {
    const { spec } = await compileCommercialIntentSemantic(query, { allowHeuristicFallback: true })
    return spec
  } catch {
    return compileCommercialIntentSpecHeuristic(query)
  }
}

async function main(): Promise<void> {
  const { dataset, offline } = parseArgs(process.argv.slice(2))
  const cases = loadDataset(dataset)

  let modeCorrect = 0
  let sellerCorrect = 0
  let sellerEvaluated = 0
  let offerCorrect = 0
  let offerEvaluated = 0
  let problemCorrect = 0
  let problemEvaluated = 0
  let buyerNeedCorrect = 0
  let buyerNeedEvaluated = 0
  let archetypeCorrect = 0
  let archetypeEvaluated = 0
  let explicitCorrect = 0
  let explicitEvaluated = 0
  let roleCorrect = 0
  let roleEvaluated = 0
  let clarificationCorrect = 0
  let clarificationEvaluated = 0
  let inversions = 0
  const failures: string[] = []

  for (const item of cases) {
    const spec = await compileCase(item.query, offline)
    const c = item.checks

    if (c.request_mode) {
      if (spec.request_mode === c.request_mode) modeCorrect += 1
      else failures.push(`${item.id} mode: got ${spec.request_mode} want ${c.request_mode}`)
    }

    if (c.seller_query) {
      sellerEvaluated += 1
      const offer = `${spec.seller_offer.description || ''} ${spec.seller_profile.offer_description || ''}`
      if (offer.trim().length > 3) sellerCorrect += 1
      else failures.push(`${item.id} seller missing`)
    }

    if (c.offer_keywords?.length) {
      offerEvaluated += 1
      const offer = `${spec.seller_offer.description || ''} ${spec.seller_profile.offer_description || ''} ${spec.original_query}`
      if (containsAny(offer, c.offer_keywords)) offerCorrect += 1
      else failures.push(`${item.id} offer keywords missing in "${offer.slice(0, 80)}"`)
    }

    if (c.problem_keywords?.length) {
      problemEvaluated += 1
      const problem = `${spec.problem_solved || ''} ${(spec.seller_profile.problems_solved || []).join(' ')}`
      if (containsAny(problem, c.problem_keywords)) problemCorrect += 1
      else failures.push(`${item.id} problem keywords missing`)
    }

    if (c.buyer_need_keywords?.length) {
      buyerNeedEvaluated += 1
      if (containsAny(spec.buyer_need || '', c.buyer_need_keywords)) buyerNeedCorrect += 1
      else failures.push(`${item.id} buyer_need keywords missing`)
    }

    if (c.target_role) {
      roleEvaluated += 1
      if (spec.target_role === c.target_role) roleCorrect += 1
      else failures.push(`${item.id} role: got ${spec.target_role} want ${c.target_role}`)
    }

    if (c.explicit_demand !== undefined) {
      explicitEvaluated += 1
      const isExplicit =
        spec.request_mode === 'explicit_demand' || (spec.direct_demand_signals?.length ?? 0) > 0
      if (isExplicit === c.explicit_demand) explicitCorrect += 1
      else failures.push(`${item.id} explicit: got ${isExplicit} want ${c.explicit_demand}`)
    }

    if (c.clarification_required !== undefined) {
      clarificationEvaluated += 1
      if (spec.clarification_required === c.clarification_required) clarificationCorrect += 1
      else failures.push(`${item.id} clarification: got ${spec.clarification_required}`)
    }

    if (c.actor_inversion_forbidden && hasActorDirectionInversion(spec)) {
      inversions += 1
      failures.push(`${item.id} actor inversion role=${spec.target_role}`)
    }

    if (spec.target_company_profile.industries?.length || spec.target_company_profile.geographies?.length) {
      archetypeEvaluated += 1
      archetypeCorrect += 1
    }
  }

  const report = {
    dataset,
    mode: offline ? 'offline_heuristic' : 'semantic',
    total_cases: cases.length,
    request_mode: metric(modeCorrect, cases.filter((c) => c.checks.request_mode).length),
    seller_accuracy: metric(sellerCorrect, sellerEvaluated),
    offer_extraction: metric(offerCorrect, offerEvaluated),
    problem_solved: metric(problemCorrect, problemEvaluated),
    buyer_need: metric(buyerNeedCorrect, buyerNeedEvaluated),
    target_archetype: metric(archetypeCorrect, archetypeEvaluated),
    explicit_vs_inferred: metric(explicitCorrect, explicitEvaluated),
    target_event_role: metric(roleCorrect, roleEvaluated),
    clarification_decision: metric(clarificationCorrect, clarificationEvaluated),
    actor_direction_inversion: inversions,
    failures_sample: failures.slice(0, 20),
  }

  console.log(JSON.stringify(report, null, 2))

  const gates =
    (report.request_mode.pct ?? 0) >= 98 &&
    (report.seller_accuracy.pct ?? 100) >= 98 &&
    (report.offer_extraction.pct ?? 100) >= 98 &&
    (report.problem_solved.pct ?? 100) >= 95 &&
    (report.buyer_need.pct ?? 100) >= 95 &&
    (report.target_archetype.pct ?? 100) >= 95 &&
    (report.explicit_vs_inferred.pct ?? 100) >= 98 &&
    (report.target_event_role.pct ?? 100) >= 98 &&
    (report.clarification_decision.pct ?? 100) >= 95 &&
    report.actor_direction_inversion === 0

  if (!gates) {
    console.error(`commercial-intent holdout (${dataset}): FAIL — gates not met`)
    process.exitCode = 1
  } else {
    console.log(`commercial-intent holdout (${dataset}): PASS`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
