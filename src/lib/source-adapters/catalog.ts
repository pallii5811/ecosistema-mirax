import type {
  AdapterDiscoveryRequest,
  SourceCapability,
  SourceCoverageStatus,
} from './contracts'

export interface CapabilityCoverage {
  status: SourceCoverageStatus
  adapter_ids: string[]
  covered_signals: string[]
  missing_signals: string[]
  reasons: string[]
}

const normalize = (values: string[]) => new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))

export class SourceCapabilityRegistry {
  private readonly capabilitiesById = new Map<string, SourceCapability>()

  constructor(capabilities: SourceCapability[] = []) {
    for (const capability of capabilities) this.register(capability)
  }

  register(capability: SourceCapability): void {
    if (this.capabilitiesById.has(capability.adapter_id)) {
      throw new Error(`Duplicate source adapter capability: ${capability.adapter_id}`)
    }
    if (capability.discovery_mode === 'generic_fallback' && capability.coverage_status === 'supported') {
      throw new Error('Generic fallback cannot claim full source coverage')
    }
    this.capabilitiesById.set(capability.adapter_id, capability)
  }

  capabilities(): SourceCapability[] {
    return [...this.capabilitiesById.values()]
  }

  resolve(
    request: AdapterDiscoveryRequest,
    requiredSourceClasses: string[] = [],
    allowGenericFallback = true,
  ): CapabilityCoverage {
    const signals = normalize(request.signal_ids)
    const requestedSources = normalize(requiredSourceClasses)
    const geographies = normalize(request.geographies)
    const eligible: SourceCapability[] = []
    const generic: SourceCapability[] = []
    const reasons: string[] = []

    for (const capability of this.capabilities()) {
      if (capability.discovery_mode === 'generic_fallback') {
        generic.push(capability)
        continue
      }
      if (capability.coverage_status !== 'supported') continue
      const intents = normalize(capability.supported_intents)
      if (!intents.has('*') && !intents.has(request.intent.toLowerCase())) continue
      const sourceClasses = normalize(capability.source_classes)
      if (requestedSources.size && ![...requestedSources].some((value) => sourceClasses.has(value))) continue
      const geographicCoverage = normalize(capability.geographic_coverage)
      if (geographies.size && !geographicCoverage.has('global') && ![...geographies].some((value) => geographicCoverage.has(value))) {
        reasons.push(`${capability.adapter_id}:geography`)
        continue
      }
      if (
        request.freshness_max_age_days != null
        && capability.freshness_max_age_days != null
        && capability.freshness_max_age_days > request.freshness_max_age_days
      ) {
        reasons.push(`${capability.adapter_id}:freshness`)
        continue
      }
      if (
        capability.max_results_per_run != null
        && request.requested_count > capability.max_results_per_run
        && !capability.supports_pagination
      ) {
        reasons.push(`${capability.adapter_id}:requested_count`)
        continue
      }
      eligible.push(capability)
    }

    const covered = new Set<string>()
    const selected: string[] = []
    for (const capability of eligible) {
      const supported = normalize(capability.supported_signals)
      const matched = supported.has('*') ? [...signals] : [...signals].filter((signal) => supported.has(signal))
      if (matched.length) {
        matched.forEach((signal) => covered.add(signal))
        selected.push(capability.adapter_id)
      }
    }
    const missing = [...signals].filter((signal) => !covered.has(signal))
    const enough = request.signal_match_mode === 'any' ? covered.size > 0 : missing.length === 0
    if (enough && selected.length) {
      return {
        status: 'supported',
        adapter_ids: selected,
        covered_signals: [...covered].sort(),
        missing_signals: missing.sort(),
        reasons,
      }
    }

    const fallbackIds = allowGenericFallback
      ? generic.filter((item) => item.coverage_status === 'generic_fallback_partial').map((item) => item.adapter_id)
      : []
    if (fallbackIds.length) {
      return {
        status: 'generic_fallback_partial',
        adapter_ids: fallbackIds,
        covered_signals: [...covered].sort(),
        missing_signals: (missing.length ? missing : [...signals]).sort(),
        reasons: [...reasons, 'structured_adapter_coverage_incomplete'],
      }
    }
    return {
      status: 'unsupported',
      adapter_ids: selected,
      covered_signals: [...covered].sort(),
      missing_signals: (missing.length ? missing : [...signals]).sort(),
      reasons: [...reasons, 'no_executable_adapter'],
    }
  }
}

export const GENERIC_WEB_RESEARCH_CAPABILITY: SourceCapability = {
  adapter_id: 'generic_web_research_v1',
  adapter_version: '1.0.0',
  supported_intents: ['*'],
  supported_signals: ['*'],
  source_classes: ['search_snippet'],
  geographic_coverage: ['global'],
  freshness_max_age_days: null,
  discovery_mode: 'generic_fallback',
  supports_pagination: true,
  supports_cursor_resume: false,
  max_results_per_page: 10,
  max_results_per_run: null,
  estimated_cost_eur_per_operation: 0.005,
  authentication_requirements: ['search_provider_optional'],
  rate_limit_per_minute: 60,
  provenance_guarantees: ['query', 'result_url', 'result_rank'],
  evidence_guarantees: ['discovery_only'],
  exhaustion_semantics: 'best_effort',
  coverage_status: 'generic_fallback_partial',
}

export const DIGITAL_AUDIT_CAPABILITY: SourceCapability = {
  adapter_id: 'legacy_digital_audit_v1',
  adapter_version: '1.0.0',
  supported_intents: ['maps', 'hybrid', 'digital_audit', 'commercial_search'],
  supported_signals: [
    'company_identity', 'website_weakness', 'site_stale', 'missing_analytics',
    'no_pixel', 'no_gtm', 'outdated_technology', 'cybersecurity_exposure',
    'no_dmarc', 'seo_errors', 'missing_instagram', 'missing_google_ads',
  ],
  source_classes: ['google_business_maps', 'technology_audit', 'official_company_website'],
  geographic_coverage: ['italy'],
  freshness_max_age_days: 1,
  discovery_mode: 'discovery_first',
  supports_pagination: false,
  supports_cursor_resume: false,
  max_results_per_page: 200,
  max_results_per_run: 200,
  estimated_cost_eur_per_operation: 0.011,
  authentication_requirements: ['google_maps_browser_access'],
  rate_limit_per_minute: 10,
  provenance_guarantees: ['company_name', 'official_domain', 'audit_observed_at'],
  evidence_guarantees: ['direct_observation', 'signal_id', 'source_url', 'excerpt'],
  exhaustion_semantics: 'best_effort',
  coverage_status: 'supported',
}

export const PROCUREMENT_CAPABILITY: SourceCapability = {
  adapter_id: 'public_procurement_v1',
  adapter_version: '1.0.0',
  supported_intents: ['organic_web_search', 'commercial_search', 'public_procurement'],
  supported_signals: ['tender_won', 'contract_awarded'],
  source_classes: ['public_procurement_portal'],
  geographic_coverage: ['italy', 'eu'],
  freshness_max_age_days: 1,
  discovery_mode: 'discovery_first',
  supports_pagination: true,
  supports_cursor_resume: true,
  max_results_per_page: 100,
  max_results_per_run: null,
  estimated_cost_eur_per_operation: 0,
  authentication_requirements: [],
  rate_limit_per_minute: 30,
  provenance_guarantees: ['publisher', 'award_id', 'authority', 'winner_role', 'source_url'],
  evidence_guarantees: ['contract_award', 'award_date', 'winner_name', 'excerpt'],
  exhaustion_semantics: 'partition',
  coverage_status: 'supported',
}

export const HIRING_CAPABILITY: SourceCapability = {
  adapter_id: 'structured_hiring_v1',
  adapter_version: '1.0.0',
  supported_intents: ['organic_web_search', 'commercial_search', 'hiring'],
  supported_signals: ['hiring', 'hiring_operational', 'hiring_sales', 'hiring_marketing', 'hiring_technology'],
  source_classes: ['company_careers', 'job_board'],
  geographic_coverage: ['global'],
  freshness_max_age_days: 1,
  discovery_mode: 'discovery_first',
  supports_pagination: true,
  supports_cursor_resume: true,
  max_results_per_page: 100,
  max_results_per_run: null,
  estimated_cost_eur_per_operation: 0.005,
  authentication_requirements: ['search_provider_with_cost_governor'],
  rate_limit_per_minute: 20,
  provenance_guarantees: ['company', 'vacancy_url', 'publisher', 'official_domain', 'extraction_method'],
  evidence_guarantees: ['vacancy_title', 'location', 'published_at', 'active_status', 'excerpt'],
  exhaustion_semantics: 'best_effort',
  coverage_status: 'supported',
}

export const GROWTH_SIGNALS_CAPABILITY: SourceCapability = {
  adapter_id: 'official_growth_signals_v1',
  adapter_version: '1.0.0',
  supported_intents: ['organic_web_search', 'commercial_search', 'hybrid', 'growth_signals'],
  supported_signals: [
    'investing_marketing', 'active_advertising', 'meta_ads_started', 'google_ads_started', 'rebranding',
    'expansion', 'new_location', 'geographic_expansion', 'production_expansion', 'product_launch',
    'service_launch', 'internationalization', 'new_equipment', 'market_entry',
  ],
  source_classes: ['official_company_website', 'recognized_local_news', 'industry_publication'],
  geographic_coverage: ['global'],
  freshness_max_age_days: 1,
  discovery_mode: 'discovery_first',
  supports_pagination: true,
  supports_cursor_resume: true,
  max_results_per_page: 100,
  max_results_per_run: null,
  estimated_cost_eur_per_operation: 0.005,
  authentication_requirements: ['search_provider_with_cost_governor'],
  rate_limit_per_minute: 20,
  provenance_guarantees: ['company', 'official_domain', 'publisher', 'source_url', 'published_at'],
  evidence_guarantees: ['signal_id', 'proof_level', 'excerpt', 'freshness', 'company_relation'],
  exhaustion_semantics: 'best_effort',
  coverage_status: 'supported',
}

export const SOURCE_CAPABILITY_REGISTRY = new SourceCapabilityRegistry([
  DIGITAL_AUDIT_CAPABILITY,
  PROCUREMENT_CAPABILITY,
  HIRING_CAPABILITY,
  GROWTH_SIGNALS_CAPABILITY,
  GENERIC_WEB_RESEARCH_CAPABILITY,
])
