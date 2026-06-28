/**
 * Blocco 9 — unit tests: AI Act audit trail builders
 */
import assert from 'node:assert/strict'
import {
  AI_ACT_DISCLAIMER,
  buildLeadExplainabilityPackage,
  buildOutreachAuditRecord,
  buildScoreMotivation,
} from '../src/lib/ai-act-audit.ts'

const lead = {
  nome: 'Hotel Test',
  sito: 'https://hotel.it',
  meta_pixel: false,
  google_tag_manager: false,
  opportunity_score: 72,
  technical_report: { has_facebook_pixel: false, seo_disaster: true, load_speed_s: 5.2 },
}

const score = buildScoreMotivation(lead)
assert.equal(score.rule_based, true)
assert.ok(score.factors.length > 0)
assert.ok(score.factors.some((f) => f.active))
assert.equal(score.disclaimer, AI_ACT_DISCLAIMER)

const pkg = buildLeadExplainabilityPackage(lead)
assert.equal(pkg.entity_ref, 'https://hotel.it')
assert.ok(pkg.technical_report.signals.length > 0)
assert.equal(pkg.ai_act.human_oversight, true)

const outreach = buildOutreachAuditRecord({
  channel: 'whatsapp',
  status: 'sent',
  rationale: 'Lead senza pixel — angolo marketing digitale',
  lead_name: 'Hotel Test',
})
assert.equal(outreach.decision_type, 'outreach')
assert.equal(outreach.model, 'gpt-4o-mini')
assert.ok(outreach.rationale.includes('pixel'))

console.log('[test-block9-ai-act] OK')
