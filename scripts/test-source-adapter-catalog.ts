import assert from 'node:assert/strict'
import { SourceCapabilityRegistry } from '../src/lib/source-adapters/catalog'
import { normalizeOpportunityCandidate, type AdapterDiscoveryRequest, type SourceCapability } from '../src/lib/source-adapters/contracts'
import { sourceRuntimeCoverage } from '../src/lib/source-intelligence/registry'

function capability(
  adapter_id: string,
  supported_signals: string[],
  overrides: Partial<SourceCapability> = {},
): SourceCapability {
  return {
    adapter_id,
    adapter_version: '1.0.0',
    supported_intents: ['commercial_search'],
    supported_signals,
    source_classes: [`${adapter_id}_source`],
    geographic_coverage: ['italy'],
    freshness_max_age_days: 7,
    discovery_mode: 'discovery_first',
    supports_pagination: true,
    supports_cursor_resume: true,
    max_results_per_page: 20,
    max_results_per_run: null,
    estimated_cost_eur_per_operation: 0.001,
    authentication_requirements: [],
    rate_limit_per_minute: 30,
    provenance_guarantees: ['source_url'],
    evidence_guarantees: ['signal_id'],
    exhaustion_semantics: 'authoritative',
    coverage_status: 'supported',
    ...overrides,
  }
}

function request(overrides: Partial<AdapterDiscoveryRequest> = {}): AdapterDiscoveryRequest {
  return {
    intent: 'commercial_search',
    signal_ids: ['tender_won'],
    signal_match_mode: 'all',
    geographies: ['italy'],
    freshness_max_age_days: 14,
    requested_count: 100,
    budget_eur: 0.125,
    query: 'fixture query',
    sectors: ['fixture sector'],
    technical_filters: {},
    ...overrides,
  }
}

const procurement = capability('procurement', ['tender_won'])
const hiring = capability('hiring', ['hiring_operational'])
const fallback = capability('generic_web', ['*'], {
  discovery_mode: 'generic_fallback',
  coverage_status: 'generic_fallback_partial',
  source_classes: ['search_snippet'],
  freshness_max_age_days: null,
  exhaustion_semantics: 'best_effort',
})

assert.equal(new SourceCapabilityRegistry().resolve(request(), [], false).status, 'unsupported')
assert.equal(sourceRuntimeCoverage('technology_audit'), 'supported')
assert.equal(sourceRuntimeCoverage('search_snippet'), 'generic_fallback_partial')
assert.equal(new SourceCapabilityRegistry([fallback]).resolve(request()).status, 'generic_fallback_partial')

const composed = new SourceCapabilityRegistry([procurement, hiring])
const all = composed.resolve(request({
  signal_ids: ['tender_won', 'hiring_operational'],
  signal_match_mode: 'all',
}))
assert.equal(all.status, 'supported')
assert.deepEqual(new Set(all.adapter_ids), new Set(['procurement', 'hiring']))

const any = new SourceCapabilityRegistry([procurement]).resolve(request({
  signal_ids: ['tender_won', 'hiring_operational'],
  signal_match_mode: 'any',
}), [], false)
assert.equal(any.status, 'supported')
assert.deepEqual(any.missing_signals, ['hiring_operational'])

const bounded = capability('bounded', ['tender_won'], {
  supports_pagination: false,
  max_results_per_run: 50,
})
assert.equal(new SourceCapabilityRegistry([bounded]).resolve(request(), [], false).status, 'unsupported')
assert.equal(new SourceCapabilityRegistry([procurement]).resolve(request({ geographies: ['france'] }), [], false).status, 'unsupported')
assert.equal(new SourceCapabilityRegistry([procurement]).resolve(request({ freshness_max_age_days: 3 }), [], false).status, 'unsupported')

assert.throws(() => new SourceCapabilityRegistry([capability('invalid_generic', ['*'], {
  discovery_mode: 'generic_fallback',
  coverage_status: 'supported',
})]), /cannot claim full source coverage/)

const candidate = normalizeOpportunityCandidate({
  entity_name: 'Acme S.r.l.',
  signal_id: 'tender_won',
  technical_report: { domain_verification: { official_domain: 'https://www.acme.example/path' } },
  evidence: [{
    signal_id: 'tender_won',
    url: 'https://publisher.example/award/1',
    publisher: 'ANAC',
    type: 'public_procurement_portal',
    text: 'Acme S.r.l. e aggiudicataria del contratto.',
    date: '2026-07-10',
    observed_at: '2026-07-14',
    confidence: 0.98,
  }],
  contacts: [{ kind: 'email', value: 'sales@acme.example', verified: true }],
  confidence: 0.9,
}, procurement)
assert.equal(candidate.official_domain, 'acme.example')
assert.equal(candidate.signal_date, '2026-07-10')
assert.equal(candidate.evidence[0]?.source_publisher, 'ANAC')
assert.equal(candidate.contacts[0]?.value, 'sales@acme.example')

console.log('source adapter catalog: OK')
