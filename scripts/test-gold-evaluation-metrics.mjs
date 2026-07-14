#!/usr/bin/env node
import assert from 'node:assert/strict'
import { buildGoldEvaluationReport } from './lib/gold-evaluation-metrics.mjs'

const positive = (dataset_version, cohort, vertical, overrides = {}) => ({
  dataset_version, cohort, vertical, label: 'positive', buyer_fit: true,
  official_domain_correct: true, entity_class_correct: true, evidence_supports_claim: true,
  signal_fresh: true, contact_extraction_status: 'available_extracted', top_tier: true,
  expected_source_policy: { reviewed_source_urls: ['https://source.example/evidence'] }, ...overrides,
})
const rows = [
  ...Array.from({ length: 25 }, () => positive('mirax-gold-v1', 'legacy_baseline', 'legacy')),
  ...Array.from({ length: 160 }, (_, index) => positive('mirax-gold-v5', 'v5_output', `v${index % 10}`)),
  ...Array.from({ length: 15 }, (_, index) => positive('mirax-gold-v5', 'adversarial', `v${index % 10}`, { label: 'negative', top_tier: false })),
]
const complete = buildGoldEvaluationReport(rows, {
  weighted_cost_per_published_lead_eur: 0.02, cold_cache_measured: true, warm_cache_measured: true,
}, {
  soak_passed: true, failure_injection_passed: true, recovery_passed: true,
  rollback_passed: true, zero_known_critical_defects: true,
})
assert.equal(complete.final_progress.completed, 200)
assert.equal(complete.quality_acceptance_ready, true)
assert.equal(complete.production_acceptance_ready, true)
assert.equal(complete.v5_evaluation_dataset.published_precision.denominator, 160)
assert.equal(complete.v5_evaluation_dataset.top_tier_precision.denominator, 160)
assert.equal(complete.adversarial_dataset.adversarial_rejection_accuracy.estimate, 1)

const mixedLegacy = buildGoldEvaluationReport(rows.map((row, index) => index === 0 ? { ...row, label: 'negative' } : row), complete.cost_measurement)
assert.equal(mixedLegacy.v5_evaluation_dataset.published_precision.estimate, 1, 'legacy must not alter v5 precision')
const missingSource = buildGoldEvaluationReport(rows.map((row, index) => index === 25 ? { ...row, expected_source_policy: {} } : row), complete.cost_measurement)
assert.equal(missingSource.quality_gates.source_url_coverage_100, false)
assert.equal(missingSource.production_acceptance_ready, false)
const incomplete = buildGoldEvaluationReport(rows.slice(0, 40), null)
assert.equal(incomplete.production_acceptance_ready, false)
const missingOperations = buildGoldEvaluationReport(rows, complete.cost_measurement, null)
assert.equal(missingOperations.evaluation_acceptance_ready, true)
assert.equal(missingOperations.production_acceptance_ready, false)
console.log('Gold evaluation metrics: composition, cohort isolation and quality gates PASS')
