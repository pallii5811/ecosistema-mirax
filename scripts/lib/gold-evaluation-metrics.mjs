export const GOLD_TARGETS = Object.freeze({ v5_output: 160, legacy_baseline: 25, adversarial: 15, total: 200 })
export const MIN_TOP_TIER_DENOMINATOR = 20

export function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return null
  const p = successes / total
  const denominator = 1 + z * z / total
  const center = (p + z * z / (2 * total)) / denominator
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
  return { numerator: successes, denominator: total, estimate: p, wilson_95: [Math.max(0, center - margin), Math.min(1, center + margin)] }
}

function isStrictPositive(row) {
  return row.label === 'positive' && row.buyer_fit === true && row.official_domain_correct === true &&
    row.entity_class_correct === true && row.evidence_supports_claim === true && row.signal_fresh === true
}

function hasReviewedSource(row) {
  const urls = row.expected_source_policy?.reviewed_source_urls
  return Array.isArray(urls) && urls.some((url) => /^https:\/\//i.test(String(url || '')))
}

export function cohortMetrics(rows, label, { adversarial = false } = {}) {
  const judged = rows.filter((row) => row.label === 'positive' || row.label === 'negative')
  const metric = (predicate, denominator = judged) => wilson(denominator.filter(predicate).length, denominator.length)
  const contacts = judged.filter((row) => ['available_extracted','available_missed'].includes(row.contact_extraction_status))
  const topTier = judged.filter((row) => row.top_tier === true)
  const verticals = Object.fromEntries([...new Set(judged.map((row) => row.vertical))].sort().map((vertical) => {
    const verticalRows = judged.filter((row) => row.vertical === vertical)
    return [vertical, adversarial
      ? wilson(verticalRows.filter((row) => row.label === 'negative').length, verticalRows.length)
      : wilson(verticalRows.filter(isStrictPositive).length, verticalRows.length)]
  }))
  return {
    label,
    cases_available: rows.length,
    human_judgments: judged.length,
    published_precision: adversarial ? null : wilson(judged.filter(isStrictPositive).length, judged.length),
    adversarial_rejection_accuracy: adversarial ? wilson(judged.filter((row) => row.label === 'negative').length, judged.length) : null,
    buyer_fit_coverage: metric((row) => row.buyer_fit === true),
    official_domain_coverage: metric((row) => row.official_domain_correct === true),
    entity_class_coverage: metric((row) => row.entity_class_correct === true),
    evidence_coverage: metric((row) => row.evidence_supports_claim === true),
    freshness_coverage: metric((row) => row.signal_fresh === true),
    source_url_coverage: metric(hasReviewedSource),
    public_contact_coverage: wilson(contacts.filter((row) => row.contact_extraction_status === 'available_extracted').length, contacts.length),
    top_tier_precision: wilson(topTier.filter(isStrictPositive).length, topTier.length),
    precision_by_vertical: verticals,
  }
}

function estimate(metric) { return metric?.estimate ?? null }

export function buildGoldEvaluationReport(rows, costMeasurement = null, operationalEvidence = null) {
  const legacyRows = rows.filter((row) => row.dataset_version === 'mirax-gold-v1')
  const v5Rows = rows.filter((row) => row.dataset_version === 'mirax-gold-v5' && row.cohort === 'v5_output')
  const adversarialRows = rows.filter((row) => row.dataset_version === 'mirax-gold-v5' && row.cohort === 'adversarial')
  const legacy = cohortMetrics(legacyRows, 'LEGACY BASELINE — calibration/regression only; not v5 precision')
  const v5 = cohortMetrics(v5Rows, 'V5 OUTPUT — primary certification cohort')
  const adversarial = cohortMetrics(adversarialRows, 'ADVERSARIAL/NEGATIVE — separate robustness cohort', { adversarial: true })
  const completed = Math.min(GOLD_TARGETS.legacy_baseline, legacy.human_judgments) +
    Math.min(GOLD_TARGETS.v5_output, v5.human_judgments) +
    Math.min(GOLD_TARGETS.adversarial, adversarial.human_judgments)
  const compositionPassed = legacy.human_judgments >= GOLD_TARGETS.legacy_baseline &&
    v5.human_judgments === GOLD_TARGETS.v5_output && adversarial.human_judgments === GOLD_TARGETS.adversarial
  const contactPassed = v5.public_contact_coverage === null || estimate(v5.public_contact_coverage) >= 0.90
  const qualityGates = {
    composition_160_25_15: compositionPassed,
    published_precision_gte_90: estimate(v5.published_precision) >= 0.90,
    top_tier_precision_gte_95: Number(v5.top_tier_precision?.denominator || 0) >= MIN_TOP_TIER_DENOMINATOR && estimate(v5.top_tier_precision) >= 0.95,
    official_domain_coverage_100: estimate(v5.official_domain_coverage) === 1,
    evidence_coverage_100: estimate(v5.evidence_coverage) === 1,
    source_url_coverage_100: estimate(v5.source_url_coverage) === 1,
    freshness_coverage_100: estimate(v5.freshness_coverage) === 1,
    public_contact_coverage_gte_90_when_available: contactPassed,
    adversarial_rejection_accuracy_100: estimate(adversarial.adversarial_rejection_accuracy) === 1,
  }
  const qualityAcceptanceReady = Object.values(qualityGates).every(Boolean)
  const costAcceptanceReady = Boolean(costMeasurement &&
    costMeasurement.weighted_cost_per_published_lead_eur <= 0.025 &&
    costMeasurement.cold_cache_measured === true && costMeasurement.warm_cache_measured === true)
  const operationalGates = {
    soak_passed: operationalEvidence?.soak_passed === true,
    failure_injection_passed: operationalEvidence?.failure_injection_passed === true,
    recovery_passed: operationalEvidence?.recovery_passed === true,
    rollback_passed: operationalEvidence?.rollback_passed === true,
    zero_known_critical_defects: operationalEvidence?.zero_known_critical_defects === true,
  }
  const operationalAcceptanceReady = Object.values(operationalGates).every(Boolean)
  return {
    evaluation_version: 'mirax-gold-v5', generated_at: new Date().toISOString(),
    final_target: GOLD_TARGETS.total, composition_target: GOLD_TARGETS,
    legacy_baseline: legacy, v5_evaluation_dataset: v5, adversarial_dataset: adversarial,
    final_progress: { completed, remaining: Math.max(0, GOLD_TARGETS.total - completed) },
    quality_gates: qualityGates,
    quality_acceptance_ready: qualityAcceptanceReady,
    cost_measurement: costMeasurement,
    cost_acceptance_ready: costAcceptanceReady,
    operational_gates: operationalGates,
    operational_acceptance_ready: operationalAcceptanceReady,
    evaluation_acceptance_ready: qualityAcceptanceReady && costAcceptanceReady,
    production_acceptance_ready: qualityAcceptanceReady && costAcceptanceReady && operationalAcceptanceReady,
    warning: 'Legacy baseline is never included in MIRAX v5 precision. Human judgments only.',
  }
}
