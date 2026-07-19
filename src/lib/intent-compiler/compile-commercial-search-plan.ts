import { createHash } from 'node:crypto'

import canonicalSchema from '../../../contracts/commercial-search-plan.schema.json'
import {
  COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION,
  safeParseCommercialSearchPlan,
  SemanticQueryContractSchema,
  type SemanticQueryContract,
  type CommercialSearchPlan,
} from '@/lib/contracts/commercial-search-plan'
import { SOURCE_BY_ID, sourceSupportsSignal } from '@/lib/source-intelligence/registry'
import { getSignalDefinition } from '@/lib/signal-ontology/ontology'
import { parseSignalIntentHeuristic } from '@/lib/signal-intent/parse-heuristic'
import { inferSellerBuyerProfile } from '@/lib/signal-intent/seller-buyer-inference'
import {
  getSemanticQueryCache,
  semanticQueryCacheKey,
  setSemanticQueryCache,
} from './semantic-query-cache'

export const COMMERCIAL_INTENT_PROMPT_VERSION = 'commercial-intent-v1.4.2' as const

export type QueryCompilerTelemetry = {
  query_tier1_calls: number
  query_tier2_calls: number
  query_cache_hits: number
  query_input_tokens: number
  query_output_tokens: number
  query_compilation_cost: number
  query_compilation_status: 'cache_hit' | 'tier1_accepted' | 'tier2_patched' | 'clarification' | 'failed'
  tier2_escalation_reason: string | null
  contract_hash: string | null
}

function cleanProviderEnv(value: string | undefined): string {
  return String(value || '').replace(/\\[rn]/g, '').trim()
}

export type PlanValidationIssue = {
  code: string
  path: string
  message: string
}

export type CommercialIntentCompilerOptions = {
  searchId?: string
  requestedLeadCount?: number
  language?: string
  allowRepair?: boolean
  allowTier2?: boolean
  onTelemetry?: (telemetry: QueryCompilerTelemetry) => void
  onDiagnostic?: (event: {
    stage: 'initial' | 'repair'
    issues: PlanValidationIssue[]
  }) => void
  costMeter?: {
    reserve(input: {
      searchId: string
      idempotencyKey: string
      operationType: 'intent_compilation'
      estimatedCostEur: number
      provider: string
      model: string
      metadata?: Record<string, unknown>
    }): Promise<unknown>
    settle(
      searchId: string,
      idempotencyKey: string,
      actualCostEur: number,
      metadata?: Record<string, unknown>,
    ): Promise<unknown>
    release(searchId: string, idempotencyKey: string, errorCode?: string): Promise<unknown>
  }
}

export function detectQueryContradictions(query: string): PlanValidationIssue[] {
  const normalized = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const issues: PlanValidationIssue[] = []
  const exclusiveGeo = normalized.match(/\b(?:solo|soltanto|esclusivamente)\s+(?:a|in)?\s*([a-z]{3,})\b/)
  if (exclusiveGeo) {
    const geo = exclusiveGeo[1]
    const exclusion = new RegExp(`\\b(?:escludi|escludendo|tranne|non\\s+in|fuori\\s+da)\\s+(?:a|in)?\\s*${geo}\\b`)
    if (exclusion.test(normalized)) {
      issues.push({ code: 'CONTRADICTORY_GEOGRAPHY', path: 'target.geographies', message: `${geo} is both required and excluded.` })
    }
  }
  const less = normalized.match(/\b(?:meno\s+di|massimo|max)\s+(\d+)\s+dipendent/)
  const more = normalized.match(/\b(?:piu\s+di|almeno|minimo|min)\s+(\d+)\s+dipendent/)
  if (less && more && Number(more[1]) >= Number(less[1])) {
    issues.push({
      code: 'IMPOSSIBLE_COMPANY_SIZE', path: 'target.employee_range',
      message: `Employee minimum ${more[1]} conflicts with maximum ${less[1]}.`,
    })
  }
  return issues
}

const TOOL_NAME = 'submit_commercial_search_plan'
const ADJUDICATOR_TOOL_NAME = 'submit_semantic_query_patch'

const TIER1_SYSTEM_PROMPT = `Compile the user's B2B search request into a compact, open-world semantic contract.
Preserve who sells, the target company, the target company's role, every explicitly required relationship,
geography, exclusions, negative conditions and time constraints. Relationships are semantic predicates, not
keyword synonyms. Never invent companies, facts, URLs or evidence.

target_role_in_event is the company's role in the event, never a person, job title, function, or buyer persona.
When the event is staffing, hiring, or team/personnel expansion, target_role_in_event must be employer
(not expanding_company). Prefer target_entity_types operating_company for operating businesses.
For sales/customer-acquisition team expansion use relationship
sales_customer_acquisition_team_expansion_by_target_company.

canonical_signal_hints are execution routing only, not semantic truth. Derive hints from the whole semantic
contract (role + relationships + event), never from an isolated geography word. Sales/customer-acquisition
hiring → hiring_sales. Emit geographic_expansion only when the event itself is territorial (new site, area,
region, province, market geography, physical presence). A target geography filter alone (e.g. Lombardia)
is not geographic_expansion; "ampliare la squadra" is staffing, not geographic expansion.

When the user states an offer, preserve its category, products/services, problems solved and likely
buyer roles in seller/offer; never treat the seller as the target. Keep strings under 160 characters and arrays
to the minimum needed. Output only via the tool.`

const TIER2_SYSTEM_PROMPT = `Adjudicate a compact semantic query contract. Do not regenerate it.
Return accept, clarification, or a patch containing only fields that are missing or invalid. Preserve the
original open-world predicate and event direction. Never replace meaning with keywords or invent facts.
If TARGET_ROLE_ENTITY_TYPE_MISMATCH is reported, patch only target_role_in_event (and required_relationships
only if needed) so the role describes the company in the event, not a person or job title.
If TARGET_ROLE_STAFFING_MISMATCH is reported, set target_role_in_event to employer and align
required_relationships to the staffing/hiring event (e.g. sales_customer_acquisition_team_expansion_by_target_company).
If ROUTING_HINT_GEOGRAPHY_MISMATCH is reported, remove geographic_expansion from canonical_signal_hints
and keep hiring-family hints when the event is staffing/team expansion.
Output only via the tool.`

function disabledFlag(value: string | undefined): boolean {
  return ['0', 'false', 'no', 'off', 'disabled'].includes(String(value ?? '').trim().toLowerCase())
}

function normalizedLeadCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 10
  return Math.max(1, Math.min(10_000, Math.trunc(value as number)))
}

type JsonSchemaNode = {
  $ref?: string
  type?: string | string[]
  required?: string[]
  minItems?: number
  maxItems?: number
  maxProperties?: number
  minLength?: number
  maxLength?: number
  additionalProperties?: boolean | JsonSchemaNode
  enum?: string[]
  minimum?: number
  maximum?: number
  $defs?: Record<string, JsonSchemaNode>
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
}

export function isSellerFramedQuery(query: string): boolean {
  return /\b(sono\s+(?:un['’]?\s*|una\s+)|vendo|offro|cerco\s+clienti|a\s+cui\s+vendere)/i.test(query)
}

/**
 * Anthropic tool schemas treat an empty array as valid unless minItems is
 * explicit. Tighten only seller-framed searches: a direct category/location
 * lookup may legitimately omit a seller offer, while a seller-to-buyer plan
 * must carry the complete causal contract in the single paid compiler call.
 */
export function compilerToolSchema(query: string): typeof canonicalSchema {
  const schema = structuredClone(canonicalSchema) as unknown as JsonSchemaNode
  const required = schema.required || (schema.required = [])
  if (!required.includes('semantic_query_contract')) required.push('semantic_query_contract')
  if (!isSellerFramedQuery(query)) return schema as typeof canonicalSchema
  const seller = schema.$defs?.seller?.properties
  const hypotheses = schema.$defs?.commercialHypothesis?.properties
  const signalPolicy = schema.$defs?.signalPolicy?.properties
  if (!seller || !hypotheses || !signalPolicy) {
    throw new Error('COMMERCIAL_COMPILER_SCHEMA_INVALID')
  }
  seller.offer_category = { type: 'string', minLength: 1, maxLength: 200 }
  if (seller.products_or_services) seller.products_or_services.minItems = 1
  if (seller.problems_solved) seller.problems_solved.minItems = 1
  if (seller.preferred_buyer_roles) seller.preferred_buyer_roles.minItems = 1
  if (hypotheses.triggering_events) hypotheses.triggering_events.minItems = 1
  if (hypotheses.signals) hypotheses.signals.minItems = 1
  if (signalPolicy.required_signals) signalPolicy.required_signals.minItems = 1
  return schema as typeof canonicalSchema
}

export function semanticCompilerToolSchema(): JsonSchemaNode {
  const definitions = (canonicalSchema as unknown as { $defs: Record<string, JsonSchemaNode> }).$defs
  const schema = structuredClone(definitions.semanticQueryContract)
  schema.$defs = {
    stringArray: {
      type: 'array', maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 240 },
    },
  }
  const compact = (node: JsonSchemaNode) => {
    if (node.type === 'string') node.maxLength = Math.min(node.maxLength || 240, 240)
    if (node.type === 'array') node.maxItems = Math.min(node.maxItems || 4, 4)
    if (node.type === 'object') node.maxProperties = Math.min(node.maxProperties || 8, 8)
    for (const child of Object.values(node.properties || {})) compact(child)
    if (node.items) compact(node.items)
    for (const child of Object.values(node.$defs || {})) compact(child)
  }
  compact(schema)
  return schema
}

const compactStringSchema = (maxLength = 180): JsonSchemaNode => ({
  type: 'string', minLength: 1, maxLength,
})

const compactStringArraySchema = (): JsonSchemaNode => ({
  type: 'array', maxItems: 4, items: compactStringSchema(180),
})

export function tier1SemanticQueryToolSchema(): JsonSchemaNode {
  const properties: Record<string, JsonSchemaNode> = {
    query_goal: compactStringSchema(),
    seller: {
      type: 'object', maxProperties: 4, additionalProperties: false,
      properties: {
        offer_category: compactStringSchema(100),
        products_or_services: compactStringArraySchema(),
        problems_solved: compactStringArraySchema(),
        preferred_buyer_roles: compactStringArraySchema(),
      },
    },
    offer: {
      type: 'object', maxProperties: 2, additionalProperties: false,
      properties: {
        description: compactStringSchema(160),
        sales_motion: compactStringSchema(80),
      },
    },
    target_entity_types: compactStringArraySchema(),
    target_company_description: compactStringSchema(),
    event_or_state_description: compactStringSchema(),
    target_role_in_event: compactStringSchema(80),
    required_relationships: compactStringArraySchema(),
    excluded_roles: compactStringArraySchema(),
    excluded_entities: compactStringArraySchema(),
    geography: compactStringArraySchema(),
    industry: compactStringArraySchema(),
    size_constraints: { type: 'object', maxProperties: 4, additionalProperties: true },
    temporal_constraints: { type: 'object', maxProperties: 4, additionalProperties: true },
    positive_conditions: compactStringArraySchema(),
    negative_conditions: compactStringArraySchema(),
    clarification_required: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    canonical_signal_hints: compactStringArraySchema(),
  }
  return {
    type: 'object', additionalProperties: false,
    required: [
      'query_goal', 'seller', 'offer', 'target_entity_types', 'target_company_description',
      'event_or_state_description', 'target_role_in_event', 'required_relationships',
      'excluded_roles', 'excluded_entities', 'geography', 'industry', 'size_constraints',
      'temporal_constraints', 'positive_conditions', 'negative_conditions',
      'clarification_required', 'confidence', 'canonical_signal_hints',
    ],
    properties,
  }
}

export function tier2SemanticPatchToolSchema(): JsonSchemaNode {
  const tier1Properties = tier1SemanticQueryToolSchema().properties || {}
  return {
    type: 'object', additionalProperties: false,
    required: ['decision', 'patch', 'reason', 'confidence'],
    properties: {
      decision: { type: 'string', enum: ['accept', 'patch', 'clarification'] },
      patch: {
        type: 'object', additionalProperties: false, maxProperties: 12,
        properties: tier1Properties,
      },
      reason: compactStringSchema(240),
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  }
}

function uniqueStrings(value: unknown, maximum = 20): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, maximum)
    : []
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function unwrapSemanticInput(input: unknown): Record<string, unknown> {
  const root = recordValue(input)
  return Object.keys(recordValue(root.semantic_query_contract)).length
    ? recordValue(root.semantic_query_contract)
    : root
}

function completeSemanticContract(query: string, input: unknown): SemanticQueryContract | null {
  const seed = unwrapSemanticInput(input)
  const role = String(seed.target_role_in_event || '').trim()
  const relationships = uniqueStrings(seed.required_relationships)
  const confidence = Math.max(0, Math.min(1, Number(seed.confidence) || 0))
  const candidate = {
    original_query: query.trim(),
    query_goal: String(seed.query_goal || '').trim(),
    seller: recordValue(seed.seller),
    offer: recordValue(seed.offer),
    target_entity_types: uniqueStrings(seed.target_entity_types).length
      ? uniqueStrings(seed.target_entity_types)
      : ['operating_company'],
    target_company_description: String(seed.target_company_description || '').trim(),
    event_or_state_description: String(seed.event_or_state_description || '').trim(),
    target_role_in_event: role,
    required_relationships: relationships,
    optional_relationships: uniqueStrings(seed.optional_relationships),
    excluded_roles: uniqueStrings(seed.excluded_roles),
    excluded_entities: uniqueStrings(seed.excluded_entities),
    geography: uniqueStrings(seed.geography),
    industry: uniqueStrings(seed.industry),
    size_constraints: recordValue(seed.size_constraints),
    temporal_constraints: recordValue(seed.temporal_constraints),
    positive_conditions: uniqueStrings(seed.positive_conditions),
    negative_conditions: uniqueStrings(seed.negative_conditions),
    must_have_facts: uniqueStrings(seed.must_have_facts).length
      ? uniqueStrings(seed.must_have_facts)
      : ['target_company_identity', 'source_evidence'],
    forbidden_inferences: uniqueStrings(seed.forbidden_inferences).length
      ? uniqueStrings(seed.forbidden_inferences)
      : ['publisher_is_target_company', 'source_domain_is_event_recipient'],
    data_requirements: uniqueStrings(seed.data_requirements).length
      ? uniqueStrings(seed.data_requirements)
      : ['official_domain', 'source_url', 'observed_at'],
    ranking_objective: String(seed.ranking_objective || 'Rank verified target-role evidence by freshness and confidence').trim(),
    acceptance_rubric: uniqueStrings(seed.acceptance_rubric).length
      ? uniqueStrings(seed.acceptance_rubric)
      : [
          `target_role_${role || 'unverified'}_grounded`,
          ...relationships.map((relationship) => `${relationship}_grounded`),
        ],
    discovery_hypotheses: Array.isArray(seed.discovery_hypotheses)
      ? seed.discovery_hypotheses.filter((item) => Object.keys(recordValue(item)).length).slice(0, 4)
      : [],
    clarification_required: seed.clarification_required === true,
    confidence,
    canonical_signal_hints: uniqueStrings(seed.canonical_signal_hints),
  }
  const parsed = SemanticQueryContractSchema.safeParse(candidate)
  if (!parsed.success) return null
  // The original wording remains authoritative at the enclosing canonical
  // plan's raw_query boundary; never replace it with generated keywords.
  if (!query.trim()) return null
  return parsed.data
}

function isCompanyEntityType(entityTypes: readonly string[]): boolean {
  return entityTypes.some((item) => {
    const value = String(item || '').trim().toLowerCase()
    return value === 'operating_company' || value === 'company' || value.includes('company')
  })
}

/**
 * Detects person/job-title roles when the target entity is a company.
 * Not semantic authority for query meaning — only entity-role mismatch gating.
 */
export function isPersonOrJobTitleTargetRole(role: string): boolean {
  const normalized = String(role || '').trim()
  if (!normalized) return false
  const compact = normalized.toLowerCase().replace(/[\s-]+/g, '_')
  if (/^(employer|recipient|beneficiary|winner|contract_winner|expanding_company|technology_adopter|former_customer|buyer_company|operating_company|company_ending_supplier_relationship)\b/.test(compact)) {
    return false
  }
  if (/\b(member|manager|director|officer|specialist|consultant|leadership|decision.?maker|persona|employee|ceo|cfo|cto|cmo|team)\b/i.test(normalized)) {
    return true
  }
  // Multi-word English role phrases naming people/functions rather than the company-in-event role.
  if (/\s/.test(normalized) && /\b(sales|marketing|business development|leadership|buyer)\b/i.test(normalized)) {
    return true
  }
  return false
}

/** Relationship predicates that mean staffing/hiring/team expansion (semantic contract, not query regex). */
export function relationshipImpliesStaffing(relationship: string): boolean {
  const value = String(relationship || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!value) return false
  if (value.includes('sales_customer_acquisition_team_expansion')) return true
  if (value.includes('sales_team_expansion')) return true
  if (/(^|_)(hiring|staffing|recruit|personnel|workforce)(_|$)/.test(value)) return true
  if (value.includes('team_expansion') || value.includes('expanding_sales_team')) return true
  if (value.includes('hiring_customer') || value.includes('customer_development_staff')) return true
  if (value.includes('scaling_customer_acquisition') && value.includes('hiring')) return true
  // Free-form contract predicates from Tier-1 that still encode staffing events.
  if (/\b(hiring|staff|team)\b/.test(value.replace(/_/g, ' ')) &&
      /\b(sales|customer|client|commerc|acquisit)\b/.test(value.replace(/_/g, ' '))) {
    return true
  }
  return false
}

/** Relationship predicates that mean territorial / geographic expansion events. */
export function relationshipImpliesGeographicExpansion(relationship: string): boolean {
  const value = String(relationship || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!value) return false
  if (value.includes('territorial') || value.includes('geographic_expansion')) return true
  if (value.includes('market_entry') || value.includes('new_location') || value.includes('new_office')) return true
  if (value.includes('new_sede') || value.includes('presence_expanded')) return true
  if (value.includes('geo_expansion') || value.includes('coverage_territor')) return true
  const words = value.replace(/_/g, ' ')
  if (/\b(territorial|geographic|province|region|sede|presenza)\b/.test(words) &&
      /\b(expand|expansion|open|apert|allarg|estend)\b/.test(words)) {
    return true
  }
  return false
}

export function contractImpliesStaffingEvent(contract: Pick<SemanticQueryContract, 'required_relationships' | 'event_or_state_description' | 'canonical_signal_hints'>): boolean {
  if ((contract.required_relationships || []).some(relationshipImpliesStaffing)) return true
  if ((contract.canonical_signal_hints || []).some((hint) => String(hint).startsWith('hiring'))) return true
  const event = String(contract.event_or_state_description || '').toLowerCase()
  return /\b(hiring|staffing|team expansion|personnel|squadra|assum)\b/.test(event) &&
    !relationshipImpliesGeographicExpansion(event)
}

export function isStaffingRoleMismatch(role: string, contract: Pick<SemanticQueryContract, 'required_relationships' | 'event_or_state_description' | 'canonical_signal_hints'>): boolean {
  if (!contractImpliesStaffingEvent(contract)) return false
  const compact = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!compact) return true
  if (compact === 'employer') return false
  // Combined territorial + sales events may legitimately use expanding_* company roles.
  if ((contract.required_relationships || []).some(relationshipImpliesGeographicExpansion)) {
    if (compact.startsWith('expanding')) return false
  }
  // expanding_company alone is too generic when the event is explicitly staffing/hiring.
  if (compact === 'expanding_company' || compact === 'changed_company' || compact === 'operating_company') return true
  return isPersonOrJobTitleTargetRole(role)
}

/** Drop geographic_expansion when geography is only a target filter and the event is staffing. */
export function filterRoutingHintsForContract(
  hints: readonly string[],
  contract: Pick<SemanticQueryContract, 'required_relationships' | 'event_or_state_description' | 'canonical_signal_hints'>,
): string[] {
  const staffing = contractImpliesStaffingEvent(contract)
  const geoEvent = (contract.required_relationships || []).some(relationshipImpliesGeographicExpansion)
  return canonicalSignals(hints).filter((hint) => {
    if (hint === 'geographic_expansion' && staffing && !geoEvent) return false
    return true
  })
}

function semanticContractIssues(
  query: string,
  contract: SemanticQueryContract | null,
): PlanValidationIssue[] {
  const issues = [...detectQueryContradictions(query)]
  if (!contract) {
    const missingCore = [
      'query_goal', 'target_company_description', 'event_or_state_description',
      'target_role_in_event', 'required_relationships', 'excluded_roles',
      'geography', 'negative_conditions', 'temporal_constraints', 'confidence',
    ]
    issues.push(...missingCore.map((path) => ({
      code: 'SEMANTIC_CONTRACT_FIELD_MISSING',
      path,
      message: `Tier-1 did not produce a valid ${path} field.`,
    })))
    return issues
  }
  if (contract.original_query !== query.trim()) {
    issues.push({ code: 'ORIGINAL_QUERY_MISMATCH', path: 'original_query', message: 'The lossless original query must remain in the semantic contract.' })
  }
  if (!contract.target_role_in_event.trim()) {
    issues.push({ code: 'TARGET_ROLE_MISSING', path: 'target_role_in_event', message: 'Target event role is required.' })
  }
  if (
    isCompanyEntityType(contract.target_entity_types) &&
    isPersonOrJobTitleTargetRole(contract.target_role_in_event)
  ) {
    issues.push({
      code: 'TARGET_ROLE_ENTITY_TYPE_MISMATCH',
      path: 'target_role_in_event',
      message: 'target_role_in_event must describe the company\'s role in the event, not a person, job title, or function.',
    })
  }
  if (isStaffingRoleMismatch(contract.target_role_in_event, contract)) {
    issues.push({
      code: 'TARGET_ROLE_STAFFING_MISMATCH',
      path: 'target_role_in_event',
      message: 'Staffing/hiring/team-expansion events require target_role_in_event=employer, not a generic expansion role.',
    })
  }
  if (contract.required_relationships.length === 0) {
    issues.push({ code: 'REQUIRED_RELATIONSHIP_MISSING', path: 'required_relationships', message: 'At least one semantic relationship is required.' })
  }
  const staffing = contractImpliesStaffingEvent(contract)
  const geoEvent = contract.required_relationships.some(relationshipImpliesGeographicExpansion)
  if (
    staffing && !geoEvent &&
    (contract.canonical_signal_hints || []).some((hint) => canonicalSignals([hint]).includes('geographic_expansion'))
  ) {
    issues.push({
      code: 'ROUTING_HINT_GEOGRAPHY_MISMATCH',
      path: 'canonical_signal_hints',
      message: 'geographic_expansion is invalid when the event is staffing/team expansion and geography is only a target filter.',
    })
  }
  if (contract.confidence < 0.72) {
    issues.push({ code: 'SEMANTIC_CONFIDENCE_LOW', path: 'confidence', message: 'Tier-1 confidence is below 0.72.' })
  }
  if (contract.clarification_required) {
    issues.push({ code: 'SEMANTIC_CLARIFICATION_REQUIRED', path: 'clarification_required', message: 'Tier-1 requires clarification.' })
  }
  return issues
}

function applySemanticPatch(
  base: unknown,
  patch: unknown,
  issues: PlanValidationIssue[],
): Record<string, unknown> {
  const seed = { ...unwrapSemanticInput(base) }
  const schemaFields = new Set(Object.keys(tier1SemanticQueryToolSchema().properties || {}))
  const allowed = new Set(
    issues.map((issue) => issue.path.split('.')[0]).filter((field) => schemaFields.has(field)),
  )
  if (issues.some((issue) => issue.code === 'TARGET_ROLE_STAFFING_MISMATCH')) {
    allowed.add('required_relationships')
    allowed.add('target_entity_types')
  }
  if (issues.some((issue) => issue.code === 'ROUTING_HINT_GEOGRAPHY_MISMATCH')) {
    allowed.add('canonical_signal_hints')
  }
  for (const [key, value] of Object.entries(recordValue(patch))) {
    if (allowed.has(key)) seed[key] = value
  }
  return seed
}

function semanticContractHash(contract: SemanticQueryContract): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex')
}

function resolveSchemaNode(node: JsonSchemaNode): JsonSchemaNode {
  if (!node.$ref?.startsWith('#/$defs/')) return node
  const name = node.$ref.slice('#/$defs/'.length)
  return ((canonicalSchema as unknown as { $defs?: Record<string, JsonSchemaNode> }).$defs?.[name] || node)
}

function pruneToCanonicalSchema(value: unknown, rawNode: JsonSchemaNode): unknown {
  const node = resolveSchemaNode(rawNode)
  if (Array.isArray(value)) {
    return node.items ? value.map((item) => pruneToCanonicalSchema(item, node.items as JsonSchemaNode)) : value
  }
  if (value && typeof value === 'object' && node.properties) {
    const source = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, childSchema] of Object.entries(node.properties)) {
      if (key in source) output[key] = pruneToCanonicalSchema(source[key], childSchema)
    }
    return output
  }
  return value
}

function canonicalSignals(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(String).map((value) => getSignalDefinition(value)?.id).filter(Boolean))] as string[]
}

function semanticPlanEnvelope(query: string, input: unknown): unknown {
  if (
    input && typeof input === 'object' && !Array.isArray(input) &&
    ('schema_version' in input || 'semantic_query_contract' in input)
  ) return input
  const parsed = SemanticQueryContractSchema.safeParse(input)
  if (!parsed.success) return { semantic_query_contract: input }
  const semantic: SemanticQueryContract = {
    ...parsed.data,
    canonical_signal_hints: filterRoutingHintsForContract(
      parsed.data.canonical_signal_hints,
      parsed.data,
    ),
  }
  // Heuristic floor is structural only; contract relationships remain authority for geo vs staffing.
  const heuristicSignals = canonicalSignals(parseSignalIntentHeuristic(query).required_signals)
  const signals = filterRoutingHintsForContract(
    canonicalSignals([...semantic.canonical_signal_hints, ...heuristicSignals]),
    semantic,
  )
  const definitions = signals
    .map((signal) => getSignalDefinition(signal))
    .filter((item): item is NonNullable<ReturnType<typeof getSignalDefinition>> => Boolean(item))
  const allowed = [...new Set([
    ...definitions.flatMap((item) => item.likelySourceClasses),
    'official_company_website', 'recognized_local_news', 'industry_publication',
  ])].filter((source) => SOURCE_BY_ID.has(source))
  const preferred = [...new Set(definitions.flatMap((item) => item.preferredSourceClasses))]
    .filter((source) => allowed.includes(source))
  const openWorld = semantic.required_relationships.length > 0
  // Open-world executable routing: keep company/news sources even with empty hints.
  // Do not invent fake canonical signals; search_snippet stays excluded from publishable proof.
  const openWorldAllowed = openWorld && signals.length === 0
    ? [...new Set([...allowed, 'official_company_website', 'recognized_local_news', 'industry_publication', 'company_careers'])]
      .filter((source) => SOURCE_BY_ID.has(source))
    : allowed
  const offerDescription = String(
    (semantic.offer as Record<string, unknown>)?.description || '',
  ).trim()
  const semanticSeller = recordValue(semantic.seller)
  const semanticOffer = recordValue(semantic.offer)
  return {
    semantic_query_contract: semantic,
    seller: {
      offer_category: String(semanticSeller.offer_category || '').trim() || null,
      offer_description: offerDescription,
      products_or_services: uniqueStrings(semanticSeller.products_or_services),
      problems_solved: uniqueStrings(semanticSeller.problems_solved),
      sales_motion: String(semanticOffer.sales_motion || '').trim() || null,
      preferred_buyer_roles: uniqueStrings(semanticSeller.preferred_buyer_roles),
    },
    target: {
      entity_types: semantic.target_entity_types.length ? semantic.target_entity_types : ['company'],
      industries: semantic.industry, company_sizes: [], geographies: semantic.geography,
      local_business_preference: true, required_attributes: semantic.must_have_facts,
      excluded_attributes: semantic.negative_conditions, excluded_entities: semantic.excluded_entities,
    },
    commercial_hypotheses: [{
      id: 'semantic-open-world', buyer_problem: semantic.event_or_state_description,
      triggering_events: [semantic.event_or_state_description], signals,
      implied_need: semantic.positive_conditions[0]
        || `Respond to verified ${semantic.required_relationships[0] || 'commercial change'}`,
      relevance_to_offer: `Verified evidence that the target acts as ${semantic.target_role_in_event} in ${semantic.required_relationships[0] || 'the requested relationship'} supports timely outreach.`,
      confidence: semantic.confidence,
    }],
    signal_policy: {
      required_signals: signals, optional_signals: [], negative_signals: [],
      maximum_age_days_by_signal: Object.fromEntries(signals.map((signal) => [
        signal, getSignalDefinition(signal)?.defaultFreshnessDays || 365,
      ])), minimum_signal_confidence: 0.75,
    },
    source_policy: {
      preferred_source_classes: preferred.length ? preferred : openWorldAllowed.slice(0, 3),
      allowed_source_classes: openWorldAllowed, excluded_source_classes: ['search_snippet', 'generic_blog', 'directory'],
      minimum_independent_sources: 1, primary_source_required_for: signals,
    },
    evidence_policy: {
      require_official_domain: true, require_source_url: true, require_observed_at: true,
      minimum_evidence_confidence: 0.75, corroboration_required_above_risk: 0.65,
    },
    audit_policy: {
      modules: ['contacts', 'social_profiles', 'company_identity', 'commercial_signals'],
      crawl_depth: 1, maximum_pages: 8, collect_contacts: true, collect_social_profiles: true,
      detect_technologies: true, detect_commercial_signals: true,
    },
    ranking_policy: {
      weight_buyer_fit: 0.25, weight_signal_strength: 0.2, weight_freshness: 0.15,
      weight_evidence_confidence: 0.2, weight_contactability: 0.1, weight_need_gap: 0.1,
    },
    budget_policy: {}, ambiguity: {
      score: 1 - semantic.confidence, assumptions: [],
      unresolved_fields: semantic.clarification_required ? ['semantic_clarification'] : [],
    },
  }
}

const GENERIC_HYPOTHESIS_TEXT = /(?:necessit[aà]\s+(?:commerciale\s+)?implicita|bisogno\s+da\s+(?:confermare|verificare)|coerenza\s+(?:da\s+validare|con\s+l[' ]?obiettivo)|richiesta\s+dell[' ]?utente)/i

function isCausalHypothesis(value: Record<string, unknown>, query: string): boolean {
  const fields = [value.buyer_problem, value.implied_need, value.relevance_to_offer]
    .map((item) => String(item || '').trim())
  return Array.isArray(value.triggering_events) && value.triggering_events.length > 0 &&
    fields.every((field) => field.length >= 12 && !GENERIC_HYPOTHESIS_TEXT.test(field) &&
      !field.toLowerCase().includes(query.trim().toLowerCase()))
}

function normalizePayload(
  input: unknown,
  query: string,
  model: string,
  options: CommercialIntentCompilerOptions,
  planner: 'llm' | 'repaired_llm',
): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const payload = pruneToCanonicalSchema(
    structuredClone(input),
    canonicalSchema as unknown as JsonSchemaNode,
  ) as Record<string, unknown>
  const requestedLeadCount = normalizedLeadCount(options.requestedLeadCount)
  const targetBudget = Number((requestedLeadCount * 0.021).toFixed(4))
  const hardBudget = Number((requestedLeadCount * 0.025).toFixed(4))

  payload.schema_version = COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION
  payload.search_id = options.searchId || `plan-${crypto.randomUUID()}`
  payload.raw_query = query
  payload.language = options.language || 'it'
  payload.planner_metadata = {
    planner,
    prompt_version: COMMERCIAL_INTENT_PROMPT_VERSION,
    model,
    generated_at: new Date().toISOString(),
  }

  const stringArray = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
    : []

  const deterministicSignalFloor = canonicalSignals(parseSignalIntentHeuristic(query).required_signals)
  const deterministicIntent = parseSignalIntentHeuristic(query)
  const inferredSeller = inferSellerBuyerProfile(query)
  const explicitSellerOffer = query.match(
    /\b(?:vendo|offro|fornisco)\s+(.+?)(?::|,|;|\s+trov\w*|\s+cerc\w*|\s+a\s+chi|\.|$)/i,
  )?.[1]?.trim() || ''
  const inferredDefinitions = deterministicSignalFloor
    .map((signal) => getSignalDefinition(signal))
    .filter((definition): definition is NonNullable<ReturnType<typeof getSignalDefinition>> => Boolean(definition))
  const familyRoles: Record<string, string[]> = {
    corporate: ['titolare', 'CFO', 'responsabile amministrazione'],
    finance: ['titolare', 'CFO'],
    workforce: ['responsabile HR', 'responsabile operations'],
    expansion: ['titolare', 'responsabile operations'],
    commercial: ['titolare', 'direttore commerciale', 'responsabile operations'],
    digital: ['titolare', 'responsabile marketing', 'responsabile IT'],
    marketing: ['titolare', 'responsabile marketing'],
    compliance: ['titolare', 'responsabile compliance'],
    risk: ['titolare', 'responsabile IT', 'responsabile compliance'],
    operations: ['titolare', 'responsabile operations'],
  }

  // Tool-capable models can legally omit non-semantic required fields even
  // when the JSON schema is supplied. Complete only structural defaults here;
  // never invent a signal, source observation, company, or evidence claim.
  const seller = (payload.seller && typeof payload.seller === 'object'
    ? payload.seller : {}) as Record<string, unknown>
  const rawDescription = String(seller.offer_description || '').trim()
  // The explicit seller clause is authoritative. A broad catalog match such
  // as CRM must not truncate a composite offer such as "ERP e CRM".
  const inferredService = String(explicitSellerOffer || inferredSeller.user_service || '').trim()
  const sellerProducts = stringArray(seller.products_or_services)
  const sellerProblems = stringArray(seller.problems_solved)
  const sellerRoles = stringArray(seller.preferred_buyer_roles)
  const ontologyProblems = [...new Set(inferredDefinitions.flatMap((definition) => definition.applicableProblems))]
  const ontologyRoles = [...new Set(inferredDefinitions.flatMap((definition) => familyRoles[definition.family] || ['titolare']))]
  payload.seller = {
    offer_category: typeof seller.offer_category === 'string' && seller.offer_category.trim()
      ? seller.offer_category.trim()
      : inferredService || null,
    offer_description: rawDescription && rawDescription.toLowerCase() !== query.toLowerCase()
      ? rawDescription
      : inferredService || rawDescription || query,
    products_or_services: sellerProducts.length ? sellerProducts : inferredService ? [inferredService] : [],
    problems_solved: sellerProblems.length ? sellerProblems : ontologyProblems,
    sales_motion: typeof seller.sales_motion === 'string' && seller.sales_motion.trim()
      ? seller.sales_motion.trim()
      : inferredService ? 'consultative_outbound' : null,
    preferred_buyer_roles: sellerRoles.length ? sellerRoles : ontologyRoles,
  }

  const budget = (payload.budget_policy && typeof payload.budget_policy === 'object'
    ? payload.budget_policy
    : {}) as Record<string, unknown>
  payload.budget_policy = {
    ...budget,
    target_cost_eur: targetBudget,
    hard_cost_eur: hardBudget,
    maximum_search_calls: Math.min(60, Math.max(4, Math.ceil(requestedLeadCount / 10))),
    maximum_pages_opened: Math.min(1_000, Math.max(15, requestedLeadCount * 2)),
    maximum_llm_evaluations: Math.min(10_000, Math.max(2, requestedLeadCount * 3 + 1)),
  }

  const evidence = (payload.evidence_policy && typeof payload.evidence_policy === 'object'
    ? payload.evidence_policy
    : {}) as Record<string, unknown>
  payload.evidence_policy = {
    ...evidence,
    require_official_domain: true,
    require_source_url: true,
    require_observed_at: true,
    minimum_evidence_confidence: Math.max(0.75, Math.min(1, Number(evidence.minimum_evidence_confidence) || 0.75)),
    corroboration_required_above_risk: Math.max(0, Math.min(1, Number(evidence.corroboration_required_above_risk) || 0.65)),
  }

  const sourcePolicy = (payload.source_policy && typeof payload.source_policy === 'object'
    ? payload.source_policy
    : {}) as Record<string, unknown>
  const excluded = Array.isArray(sourcePolicy.excluded_source_classes)
    ? sourcePolicy.excluded_source_classes.map(String)
    : []
  payload.source_policy = {
    ...sourcePolicy,
    excluded_source_classes: [
      ...new Set([...excluded, 'search_snippet', 'generic_blog', 'directory']),
    ],
  }

  const signalPolicy = (payload.signal_policy && typeof payload.signal_policy === 'object'
    ? payload.signal_policy
    : {}) as Record<string, unknown>
  const semanticEarly = payload.semantic_query_contract && typeof payload.semantic_query_contract === 'object'
    ? payload.semantic_query_contract as Record<string, unknown>
    : null
  const contractForSignals = {
    required_relationships: stringArray(semanticEarly?.required_relationships),
    event_or_state_description: String(semanticEarly?.event_or_state_description || ''),
    canonical_signal_hints: stringArray(semanticEarly?.canonical_signal_hints),
  }
  const requiredSignals = filterRoutingHintsForContract(
    [...new Set([
      ...canonicalSignals(signalPolicy.required_signals),
      ...deterministicSignalFloor,
      ...canonicalSignals(contractForSignals.canonical_signal_hints),
    ])],
    contractForSignals,
  )
  const optionalSignals = canonicalSignals(signalPolicy.optional_signals).filter(
    (signal) => !requiredSignals.includes(signal),
  )
  const negativeSignals = canonicalSignals(signalPolicy.negative_signals)
  const rawFreshness = signalPolicy.maximum_age_days_by_signal && typeof signalPolicy.maximum_age_days_by_signal === 'object'
    ? signalPolicy.maximum_age_days_by_signal as Record<string, unknown>
    : {}
  signalPolicy.required_signals = requiredSignals
  signalPolicy.optional_signals = optionalSignals
  signalPolicy.negative_signals = negativeSignals
  signalPolicy.maximum_age_days_by_signal = Object.fromEntries(
    [...requiredSignals, ...optionalSignals].map((signal) => {
      const definition = getSignalDefinition(signal)
      const raw = Number(rawFreshness[signal])
      return [signal, Number.isInteger(raw) && raw >= 1 && raw <= 3650 ? raw : definition?.defaultFreshnessDays || 365]
    }),
  )
  signalPolicy.minimum_signal_confidence = Math.max(
    0.7, Math.min(1, Number(signalPolicy.minimum_signal_confidence) || 0.75),
  )
  payload.signal_policy = signalPolicy

  const semantic = payload.semantic_query_contract && typeof payload.semantic_query_contract === 'object'
    ? payload.semantic_query_contract as Record<string, unknown>
    : null
  if (semantic) {
    const contractView = {
      required_relationships: stringArray(semantic.required_relationships),
      event_or_state_description: String(semantic.event_or_state_description || ''),
      canonical_signal_hints: stringArray(semantic.canonical_signal_hints),
    }
    semantic.canonical_signal_hints = filterRoutingHintsForContract(
      canonicalSignals(semantic.canonical_signal_hints),
      contractView,
    )
    if (isCompanyEntityType(stringArray(semantic.target_entity_types))) {
      const types = stringArray(semantic.target_entity_types)
      semantic.target_entity_types = (types.some((item) => /operating_company/i.test(item))
        ? ['operating_company']
        : [...new Set(types.map((item) => (
          /^(company|organization)$/i.test(item) ? 'operating_company' : item
        )))]) as string[]
      if (!(semantic.target_entity_types as string[]).length) {
        semantic.target_entity_types = ['operating_company']
      }
    }
    if (isStaffingRoleMismatch(String(semantic.target_role_in_event || ''), contractView)) {
      semantic.target_role_in_event = 'employer'
    }
    if (
      contractImpliesStaffingEvent(contractView) &&
      !contractView.required_relationships.some(relationshipImpliesGeographicExpansion)
    ) {
      const staffingRels = contractView.required_relationships.filter(relationshipImpliesStaffing)
      if (staffingRels.length && !staffingRels.some((rel) =>
        String(rel).includes('sales_customer_acquisition_team_expansion_by_target_company'))) {
        semantic.required_relationships = [
          'sales_customer_acquisition_team_expansion_by_target_company',
          ...staffingRels,
        ].slice(0, 4)
      }
    }
    payload.semantic_query_contract = semantic
    // Re-filter signals after role/relationship normalization.
    const refreshed = filterRoutingHintsForContract(requiredSignals, {
      required_relationships: stringArray(semantic.required_relationships),
      event_or_state_description: String(semantic.event_or_state_description || ''),
      canonical_signal_hints: stringArray(semantic.canonical_signal_hints),
    })
    signalPolicy.required_signals = refreshed
    signalPolicy.maximum_age_days_by_signal = Object.fromEntries(
      refreshed.map((signal) => {
        const definition = getSignalDefinition(signal)
        const raw = Number(rawFreshness[signal])
        return [signal, Number.isInteger(raw) && raw >= 1 && raw <= 3650 ? raw : definition?.defaultFreshnessDays || 365]
      }),
    )
    payload.signal_policy = signalPolicy
    requiredSignals.length = 0
    requiredSignals.push(...refreshed)
  }

  const hypotheses = Array.isArray(payload.commercial_hypotheses)
    ? payload.commercial_hypotheses.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : []
  for (const [index, hypothesis] of hypotheses.entries()) {
    hypothesis.id = String(hypothesis.id || `hypothesis-${index + 1}`).trim()
    hypothesis.buyer_problem = String(hypothesis.buyer_problem || 'Necessita del buyer da verificare').trim()
    hypothesis.triggering_events = stringArray(hypothesis.triggering_events)
    hypothesis.signals = canonicalSignals(hypothesis.signals)
    hypothesis.implied_need = String(hypothesis.implied_need || 'Bisogno da confermare con evidenza').trim()
    hypothesis.relevance_to_offer = String(hypothesis.relevance_to_offer || 'Coerenza da validare con l obiettivo utente').trim()
    hypothesis.confidence = Math.max(0, Math.min(1, Number(hypothesis.confidence) || 0.5))
  }
  const causalHypotheses = hypotheses.filter((hypothesis) => isCausalHypothesis(hypothesis, query))
  const normalizedSellerProducts = (payload.seller as Record<string, unknown>).products_or_services as string[]
  const normalizedSellerProblems = (payload.seller as Record<string, unknown>).problems_solved as string[]
  for (const signal of requiredSignals) {
    if (causalHypotheses.some((hypothesis) => (hypothesis.signals as string[]).includes(signal))) continue
    const definition = getSignalDefinition(signal)
    if (!definition) continue
    if (
      (normalizedSellerProducts.length === 0 || normalizedSellerProblems.length === 0)
      && definition.family !== 'digital'
    ) continue
    const buyerCondition = definition.applicableProblems[0]
    const sellerProblem = normalizedSellerProblems[0] || buyerCondition
    const product = normalizedSellerProducts[0]
    causalHypotheses.push({
      id: `ontology-${signal}`,
      buyer_problem: `La verifica di ${definition.description} evidenzia ${buyerCondition}; il seller risolve ${sellerProblem}.`,
      triggering_events: definition.relatedEvents.slice(0, 3),
      signals: [signal],
      implied_need: product
        ? `Valutare ${product} per gestire ${buyerCondition} nel momento in cui il segnale viene verificato.`
        : `Correggere ${buyerCondition} quando il segnale ${signal} viene verificato direttamente.`,
      relevance_to_offer: product
        ? `${definition.description} rende attuale ${sellerProblem} e giustifica la valutazione di ${product}.`
        : `${definition.description} rende attuale il problema ${buyerCondition} esplicitamente richiesto nella ricerca.`,
      confidence: Math.max(0.7, definition.defaultStrength),
    })
  }
  payload.commercial_hypotheses = causalHypotheses.slice(0, 12)

  const canonicalAllowed = new Set(
    (Array.isArray(sourcePolicy.allowed_source_classes) ? sourcePolicy.allowed_source_classes : [])
      .map(String)
      .filter((source) => SOURCE_BY_ID.has(source)),
  )
  for (const signal of requiredSignals) {
    for (const source of getSignalDefinition(signal)?.likelySourceClasses || []) canonicalAllowed.add(source)
  }
  const allowedSourceClasses = canonicalAllowed.size > 0
    ? [...canonicalAllowed]
    : ['official_company_website']
  sourcePolicy.allowed_source_classes = allowedSourceClasses
  const preferredFromPayload = [
    ...new Set(
      (Array.isArray(sourcePolicy.preferred_source_classes) ? sourcePolicy.preferred_source_classes : [])
        .map(String)
        .filter((source) => canonicalAllowed.has(source)),
    ),
  ]
  const preferredPerSignal: string[] = []
  for (const signal of requiredSignals) {
    const definition = getSignalDefinition(signal)
    const preferred = definition?.preferredSourceClasses.find((source) => canonicalAllowed.has(source))
      || definition?.likelySourceClasses.find((source) => canonicalAllowed.has(source))
    if (preferred && !preferredPerSignal.includes(preferred)) preferredPerSignal.push(preferred)
  }
  sourcePolicy.preferred_source_classes = preferredPerSignal.length > 0
    ? preferredPerSignal
    : preferredFromPayload.length > 0
      ? preferredFromPayload
      : allowedSourceClasses.slice(0, 3)
  sourcePolicy.primary_source_required_for = canonicalSignals(sourcePolicy.primary_source_required_for)
  sourcePolicy.minimum_independent_sources = Math.max(
    1, Math.min(5, Math.trunc(Number(sourcePolicy.minimum_independent_sources) || 1)),
  )
  payload.source_policy = {
    ...sourcePolicy,
    excluded_source_classes: [
      ...new Set([...excluded, 'search_snippet', 'generic_blog', 'directory']),
    ],
  }

  const target = (payload.target && typeof payload.target === 'object' ? payload.target : {}) as Record<string, unknown>
  target.entity_types = stringArray(target.entity_types).length ? stringArray(target.entity_types) : ['company']
  target.industries = stringArray(target.industries)
  target.company_sizes = stringArray(target.company_sizes)
  let targetGeographies = stringArray(target.geographies)
  const targetExcludedAttributes = stringArray(target.excluded_attributes)
  target.geographies = targetGeographies
  target.required_attributes = stringArray(target.required_attributes)
  target.excluded_attributes = targetExcludedAttributes
  target.excluded_entities = stringArray(target.excluded_entities)
  target.local_business_preference = target.local_business_preference === true
  // Literal category and geography are hard query constraints. The model may
  // enrich them, but it cannot replace or drop what deterministic parsing saw.
  if (deterministicIntent.category) {
    target.industries = [deterministicIntent.category]
    target.entity_types = ['company']
  }
  if (deterministicIntent.location) targetGeographies = [deterministicIntent.location]
  if (/\b(?:italia|italian[aei])\b/i.test(query) && !targetGeographies.some((value) => /italia/i.test(value))) {
    targetGeographies.push('Italia')
  }
  if (/\besclud\w*[^.]{0,80}\b(?:grand[ei]|grupp[oi])\b/i.test(query)) {
    targetExcludedAttributes.push('grande impresa', 'grande gruppo')
  }
  if (/\besclud\w*[^.]{0,120}\b(?:brand|aziend[ae]\s+famos[ae])\b/i.test(query)) {
    targetExcludedAttributes.push('brand famoso')
  }
  target.geographies = [...new Set(targetGeographies)]
  target.excluded_attributes = [...new Set(targetExcludedAttributes)]
  if (target.local_business_preference === true || /\b(?:pmi|piccol[aei]|medi[ae]|escludi\s+(?:grandi|brand))\b/i.test(query)) {
    target.local_business_preference = true
    const sizes = Array.isArray(target.company_sizes) ? target.company_sizes.map(String) : []
    if (!sizes.some((value) => /micro|small|medium|pmi|piccol|medi/i.test(value))) {
      target.company_sizes = ['micro', 'small', 'medium']
    }
  }
  payload.target = target

  const audit = (payload.audit_policy && typeof payload.audit_policy === 'object'
    ? payload.audit_policy : {}) as Record<string, unknown>
  payload.audit_policy = {
    modules: stringArray(audit.modules).length
      ? stringArray(audit.modules)
      : ['contacts', 'social_profiles', 'company_identity', 'commercial_signals'],
    crawl_depth: Math.max(0, Math.min(5, Math.trunc(Number(audit.crawl_depth) || 1))),
    maximum_pages: Math.max(1, Math.min(100, Math.trunc(Number(audit.maximum_pages) || 8))),
    collect_contacts: audit.collect_contacts !== false,
    collect_social_profiles: audit.collect_social_profiles !== false,
    detect_technologies: audit.detect_technologies === true || inferredDefinitions.some(
      (definition) => definition.family === 'digital',
    ),
    detect_commercial_signals: audit.detect_commercial_signals !== false,
  }

  const ambiguity = (payload.ambiguity && typeof payload.ambiguity === 'object'
    ? payload.ambiguity : {}) as Record<string, unknown>
  payload.ambiguity = {
    score: Math.max(0, Math.min(1, Number(ambiguity.score) || 0.5)),
    assumptions: stringArray(ambiguity.assumptions),
    unresolved_fields: stringArray(ambiguity.unresolved_fields),
  }

  const ranking = (payload.ranking_policy && typeof payload.ranking_policy === 'object'
    ? payload.ranking_policy
    : {}) as Record<string, unknown>
  const rankingKeys = [
    'weight_buyer_fit', 'weight_signal_strength', 'weight_freshness',
    'weight_evidence_confidence', 'weight_contactability', 'weight_need_gap',
  ]
  const weights = rankingKeys.map((key) => Math.max(0, Math.min(1, Number(ranking[key]) || 0)))
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  if (weightSum > 0) {
    rankingKeys.forEach((key, index) => { ranking[key] = weights[index] / weightSum })
  } else {
    const defaults = [0.25, 0.2, 0.15, 0.2, 0.1, 0.1]
    rankingKeys.forEach((key, index) => { ranking[key] = defaults[index] })
  }
  payload.ranking_policy = ranking
  return payload
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
      .map((token) => (token.length > 6 ? token.slice(0, 6) : token)),
  )
}

export function validateCommercialPlanSemantics(plan: CommercialSearchPlan): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [...detectQueryContradictions(plan.raw_query)]
  if (plan.planner_metadata.prompt_version === COMMERCIAL_INTENT_PROMPT_VERSION) {
    const semantic = plan.semantic_query_contract
    if (!semantic) {
      issues.push({
        code: 'SEMANTIC_QUERY_CONTRACT_MISSING',
        path: 'semantic_query_contract',
        message: 'AI-native plans require the lossless open-world semantic query contract.',
      })
    } else {
      if (!semantic.clarification_required && semantic.required_relationships.length === 0) {
        issues.push({
          code: 'SEMANTIC_RELATIONSHIP_MISSING',
          path: 'semantic_query_contract.required_relationships',
          message: 'Executable semantic contracts require at least one explicit target relationship.',
        })
      }
      if (!semantic.clarification_required && !semantic.target_role_in_event.trim()) {
        issues.push({
          code: 'SEMANTIC_TARGET_ROLE_MISSING',
          path: 'semantic_query_contract.target_role_in_event',
          message: 'Executable semantic contracts require the target company role.',
        })
      }
      if (!semantic.clarification_required && semantic.acceptance_rubric.length === 0) {
        issues.push({
          code: 'SEMANTIC_ACCEPTANCE_RUBRIC_MISSING',
          path: 'semantic_query_contract.acceptance_rubric',
          message: 'Executable semantic contracts require a deterministic acceptance rubric.',
        })
      }
      if (semantic.excluded_roles.includes(semantic.target_role_in_event)) {
        issues.push({
          code: 'SEMANTIC_TARGET_ROLE_EXCLUDED',
          path: 'semantic_query_contract.excluded_roles',
          message: 'The required target role cannot also be excluded.',
        })
      }
    }
  }
  const sellerTokens = tokenSet(
    [plan.seller.offer_category, plan.seller.offer_description, ...plan.seller.products_or_services]
      .filter(Boolean)
      .join(' '),
  )
  const industryTokens = tokenSet(plan.target.industries.join(' '))
  const overlap = [...industryTokens].filter((token) => sellerTokens.has(token))
  const sellerFramed = isSellerFramedQuery(plan.raw_query)
  if (sellerFramed) {
    const normalizedDescription = plan.seller.offer_description.trim().toLowerCase()
    const normalizedQuery = plan.raw_query.trim().toLowerCase()
    const requiredSellerFields: Array<[boolean, string, string]> = [
      [Boolean(plan.seller.offer_category?.trim()), 'SELLER_OFFER_CATEGORY_MISSING', 'seller.offer_category'],
      [plan.seller.products_or_services.length > 0, 'SELLER_PRODUCT_MISSING', 'seller.products_or_services'],
      [plan.seller.problems_solved.length > 0, 'SELLER_PROBLEM_MISSING', 'seller.problems_solved'],
      [plan.seller.preferred_buyer_roles.length > 0, 'BUYER_ROLE_MISSING', 'seller.preferred_buyer_roles'],
      [normalizedDescription !== normalizedQuery, 'SELLER_DESCRIPTION_COPIES_QUERY', 'seller.offer_description'],
    ]
    for (const [passed, code, path] of requiredSellerFields) {
      if (!passed) {
        issues.push({
          code,
          path,
          message: 'Seller-framed plans must explicitly identify the offer, problem solved and relevant buyer function.',
        })
      }
    }
  }
  if (sellerFramed && industryTokens.size > 0 && overlap.length / industryTokens.size >= 0.75) {
    issues.push({
      code: 'SELLER_BUYER_INVERSION',
      path: 'target.industries',
      message: 'Target industries mostly repeat the seller offer; infer plausible buyer industries instead.',
    })
  }

  const hypothesisSignals = new Set(plan.commercial_hypotheses.flatMap((item) => item.signals))
  for (const [index, hypothesis] of plan.commercial_hypotheses.entries()) {
    const carriesRequiredSignal = hypothesis.signals.some((signal) =>
      plan.signal_policy.required_signals.includes(signal),
    )
    if (carriesRequiredSignal && hypothesis.triggering_events.length === 0) {
      issues.push({
        code: 'TRIGGERING_EVENT_MISSING',
        path: `commercial_hypotheses.${index}.triggering_events`,
        message: 'Every required buying signal must be tied to a concrete triggering event.',
      })
    }
    for (const [field, value] of [
      ['buyer_problem', hypothesis.buyer_problem],
      ['implied_need', hypothesis.implied_need],
      ['relevance_to_offer', hypothesis.relevance_to_offer],
    ] as const) {
      if (GENERIC_HYPOTHESIS_TEXT.test(value) || value.trim().toLowerCase().includes(plan.raw_query.trim().toLowerCase())) {
        issues.push({
          code: 'GENERIC_COMMERCIAL_HYPOTHESIS',
          path: `commercial_hypotheses.${index}.${field}`,
          message: 'Commercial hypotheses must be causal and specific, not placeholders or copies of the query.',
        })
      }
    }
  }
  for (const signal of [
    ...plan.signal_policy.required_signals,
    ...plan.signal_policy.optional_signals,
    ...plan.commercial_hypotheses.flatMap((item) => item.signals),
  ]) {
    if (!getSignalDefinition(signal)) {
      issues.push({
        code: 'UNKNOWN_SIGNAL_ID',
        path: 'signal_policy',
        message: `Signal ${signal} is not present in the canonical ontology.`,
      })
    }
  }
  for (const signal of plan.signal_policy.required_signals) {
    if (!hypothesisSignals.has(signal)) {
      issues.push({
        code: 'ORPHAN_REQUIRED_SIGNAL',
        path: 'signal_policy.required_signals',
        message: `Required signal ${signal} is not justified by any commercial hypothesis.`,
      })
    }
    if (!plan.signal_policy.maximum_age_days_by_signal[signal]) {
      issues.push({
        code: 'MISSING_SIGNAL_FRESHNESS',
        path: `signal_policy.maximum_age_days_by_signal.${signal}`,
        message: `Required signal ${signal} has no maximum age.`,
      })
    }
  }

  if (plan.source_policy.allowed_source_classes.length === 0) {
    issues.push({
      code: 'NO_ALLOWED_SOURCE',
      path: 'source_policy.allowed_source_classes',
      message: 'At least one executable source class is required.',
    })
  }
  for (const sourceClass of plan.source_policy.allowed_source_classes) {
    if (!SOURCE_BY_ID.has(sourceClass)) {
      issues.push({
        code: 'UNKNOWN_SOURCE_CLASS',
        path: 'source_policy.allowed_source_classes',
        message: `Source class ${sourceClass} is not present in the deterministic registry.`,
      })
    }
  }
  for (const sourceClass of plan.source_policy.preferred_source_classes) {
    if (!plan.source_policy.allowed_source_classes.includes(sourceClass)) {
      issues.push({
        code: 'PREFERRED_SOURCE_NOT_ALLOWED',
        path: 'source_policy.preferred_source_classes',
        message: `Preferred source ${sourceClass} must also be allowed.`,
      })
    }
  }
  for (const signal of plan.signal_policy.required_signals) {
    const viable = plan.source_policy.allowed_source_classes.some((sourceClass) =>
      sourceSupportsSignal(sourceClass, signal),
    )
    if (!viable) {
      issues.push({
        code: 'SIGNAL_WITHOUT_VIABLE_SOURCE',
        path: 'source_policy.allowed_source_classes',
        message: `No allowed source class can support required signal ${signal}.`,
      })
    }
  }
  if (plan.signal_policy.required_signals.length > 0) {
    if (!plan.evidence_policy.require_official_domain || !plan.evidence_policy.require_source_url) {
      issues.push({
        code: 'WEAK_EVIDENCE_POLICY',
        path: 'evidence_policy',
        message: 'Signal-led plans must require an official domain and a source URL.',
      })
    }
  }
  if (plan.target.local_business_preference) {
    const sizes = plan.target.company_sizes.map((value) => value.toLowerCase())
    if (!sizes.some((value) => /micro|small|medium|pmi|piccol|medi/.test(value))) {
      issues.push({
        code: 'LOCAL_SME_SIZE_MISSING',
        path: 'target.company_sizes',
        message: 'Local-business preference requires explicit micro/small/medium sizing.',
      })
    }
  }
  return issues
}

type QueryCompilerStage = 'tier1' | 'tier2'
type StageCallResult = {
  input: unknown | null
  status: 'completed' | 'truncated' | 'provider_error'
  inputTokens: number
  outputTokens: number
  costEur: number
}

async function callCompilerStage(input: {
  query: string
  model: string
  apiKey: string
  options: CommercialIntentCompilerOptions
  stage: QueryCompilerStage
  tier1Contract?: unknown
  issues?: PlanValidationIssue[]
}): Promise<StageCallResult> {
  const { query, model, apiKey, options, stage } = input
  const searchId = options.searchId
  const meter = options.costMeter
  if (!searchId || !meter) {
    console.warn('[commercial-intent-compiler] paid_call_blocked_without_cost_governor')
    return { input: null, status: 'provider_error', inputTokens: 0, outputTokens: 0, costEur: 0 }
  }
  const tier = stage === 'tier1' ? 1 : 2
  const idempotencyKey = `intent:${COMMERCIAL_INTENT_PROMPT_VERSION}:${stage}`
  const prefix = stage === 'tier1' ? 'UQE_ANTHROPIC_TIER1' : 'UQE_ANTHROPIC_TIER2'
  const configuredMax = Number(process.env[`${prefix}_MAX_CALL_EUR`] || 0)
  const maxOutputTokens = Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || (tier === 1 ? 1_000 : 700))
  const inputRate = Number(process.env[`${prefix}_INPUT_EUR_PER_MILLION`] || (tier === 1 ? 1 : 3))
  const outputRate = Number(process.env[`${prefix}_OUTPUT_EUR_PER_MILLION`] || (tier === 1 ? 5 : 15))
  const toolSchema = tier === 1 ? tier1SemanticQueryToolSchema() : tier2SemanticPatchToolSchema()
  const systemPrompt = tier === 1 ? TIER1_SYSTEM_PROMPT : TIER2_SYSTEM_PROMPT
  const messagePayload = tier === 1
    ? { original_query: query }
    : {
        original_query: query,
        tier1_contract: unwrapSemanticInput(input.tier1Contract),
        validation_issues: (input.issues || []).map(({ code, path, message }) => ({ code, path, message })),
        fields_to_correct: [...new Set((input.issues || []).map((issue) => issue.path.split('.')[0]).filter(Boolean))],
      }
  const serializedUpperBound = Buffer.byteLength(
    `${systemPrompt}\n${JSON.stringify(messagePayload)}\n${JSON.stringify(toolSchema)}`,
    'utf8',
  ) + 1_024
  const inputTokenUpperBound = Math.ceil(serializedUpperBound / 2)
  const computedUpperBound = 1.15 * (
    inputTokenUpperBound * inputRate + maxOutputTokens * outputRate
  ) / 1_000_000
  const estimatedCostEur = Math.max(
    Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 0,
    computedUpperBound,
  )
  const reservation = await meter.reserve({
    searchId,
    idempotencyKey,
    operationType: 'intent_compilation',
    estimatedCostEur,
    provider: 'anthropic',
    model,
    metadata: { call_kind: stage, tier, prompt_version: COMMERCIAL_INTENT_PROMPT_VERSION },
  })
  if (
    reservation &&
    typeof reservation === 'object' &&
    'status' in reservation &&
    String((reservation as { status?: unknown }).status || 'reserved') !== 'reserved'
  ) {
    console.warn('[commercial-intent-compiler] idempotency_hit_without_cached_payload')
    return { input: null, status: 'provider_error', inputTokens: 0, outputTokens: 0, costEur: 0 }
  }

  let response: Response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      tools: [
        {
          name: tier === 1 ? TOOL_NAME : ADJUDICATOR_TOOL_NAME,
          description: tier === 1
            ? 'Submit the compact lossless open-world semantic query contract.'
            : 'Submit a decision and only the semantic fields that require correction.',
          input_schema: toolSchema,
        },
      ],
      tool_choice: { type: 'tool', name: tier === 1 ? TOOL_NAME : ADJUDICATOR_TOOL_NAME },
      messages: [{ role: 'user', content: JSON.stringify(messagePayload) }],
      ...(/haiku/i.test(model) ? { temperature: 0 } : {}),
    }),
    signal: AbortSignal.timeout(28_000),
    })
  } catch (error) {
    await meter.settle(searchId, idempotencyKey, estimatedCostEur, {
      outcome: 'provider_delivery_uncertain',
      error_type: error instanceof Error ? error.name : 'FETCH_FAILED',
    })
    throw error
  }
  if (!response.ok) {
    await meter.release(searchId, idempotencyKey, `provider_http_${response.status}`)
    console.warn('[commercial-intent-compiler] provider_http_error', { status: response.status })
    return { input: null, status: 'provider_error', inputTokens: 0, outputTokens: 0, costEur: 0 }
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; name?: string; input?: unknown }>
    usage?: { input_tokens?: number; output_tokens?: number }
    stop_reason?: string
  }
  const inputTokens = Math.max(0, Number(data.usage?.input_tokens || 0))
  const outputTokens = Math.max(0, Number(data.usage?.output_tokens || 0))
  const actualCostEur = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
  await meter.settle(searchId, idempotencyKey, actualCostEur, {
    tier,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    pricing_mode: 'token_rates_with_model_safe_defaults',
  })
  const toolName = tier === 1 ? TOOL_NAME : ADJUDICATOR_TOOL_NAME
  const toolInput = data.content?.find((block) => block.type === 'tool_use' && block.name === toolName)?.input ?? null
  return {
    input: toolInput,
    status: data.stop_reason === 'max_tokens' ? 'truncated' : 'completed',
    inputTokens,
    outputTokens,
    costEur: actualCostEur,
  }
}

export async function compileCommercialSearchPlan(
  query: string,
  options: CommercialIntentCompilerOptions = {},
): Promise<CommercialSearchPlan | null> {
  if (disabledFlag(process.env.UQE_ANTHROPIC_ENABLED)) return null
  const apiKey = cleanProviderEnv(process.env.ANTHROPIC_API_KEY)
  if (!apiKey) return null
  const tier1Model = cleanProviderEnv(process.env.UQE_ANTHROPIC_TIER1_MODEL || 'claude-haiku-4-5')
  const tier2Model = cleanProviderEnv(
    process.env.UQE_ANTHROPIC_TIER2_MODEL || process.env.UQE_ANTHROPIC_MODEL || 'claude-sonnet-5',
  )
  const modelVersion = `${tier1Model}|${tier2Model}`
  const telemetry: QueryCompilerTelemetry = {
    query_tier1_calls: 0, query_tier2_calls: 0, query_cache_hits: 0,
    query_input_tokens: 0, query_output_tokens: 0, query_compilation_cost: 0,
    query_compilation_status: 'failed', tier2_escalation_reason: null, contract_hash: null,
  }
  const emitTelemetry = () => options.onTelemetry?.({ ...telemetry })
  const cacheKey = semanticQueryCacheKey({
    query,
    requestedCount: normalizedLeadCount(options.requestedLeadCount),
    language: options.language || 'it',
    modelVersion,
    interpreterSchemaVersion: COMMERCIAL_INTENT_PROMPT_VERSION,
  })
  const cached = await getSemanticQueryCache(cacheKey)
  if (cached) {
    const parsed = safeParseCommercialSearchPlan(cached)
    if (parsed.success && validateCommercialPlanSemantics(parsed.data).length === 0) {
      telemetry.query_cache_hits = 1
      telemetry.query_compilation_status = 'cache_hit'
      telemetry.contract_hash = parsed.data.semantic_query_contract
        ? semanticContractHash(parsed.data.semantic_query_contract)
        : null
      emitTelemetry()
      return parsed.data
    }
  }

  try {
    const tier1 = await callCompilerStage({ query, model: tier1Model, apiKey, options, stage: 'tier1' })
    telemetry.query_tier1_calls = 1
    telemetry.query_input_tokens += tier1.inputTokens
    telemetry.query_output_tokens += tier1.outputTokens
    telemetry.query_compilation_cost += tier1.costEur
    let semanticInput: unknown = tier1.input
    let contract = completeSemanticContract(query, semanticInput)
    let issues = semanticContractIssues(query, contract)
    if (tier1.status === 'truncated') {
      issues.unshift({
        code: 'SEMANTIC_QUERY_OUTPUT_TRUNCATED', path: 'semantic_query_contract',
        message: 'Tier-1 output was truncated; compact adjudication is required.',
      })
    } else if (tier1.status === 'provider_error') {
      issues.unshift({
        code: 'SEMANTIC_QUERY_TIER1_FAILED', path: 'semantic_query_contract',
        message: 'Tier-1 provider did not return a semantic contract.',
      })
    }

    const needsTier2 = issues.length > 0
    let planner: 'llm' | 'repaired_llm' = 'llm'
    let finalModel = tier1Model
    if (needsTier2) {
      options.onDiagnostic?.({ stage: 'initial', issues })
      telemetry.tier2_escalation_reason = [...new Set(issues.map((issue) => issue.code))].join(',')
      const tier2Allowed = options.allowTier2 ?? options.allowRepair !== false
      if (!tier2Allowed) {
        emitTelemetry()
        return null
      }
      const tier2 = await callCompilerStage({
        query, model: tier2Model, apiKey, options, stage: 'tier2',
        tier1Contract: semanticInput, issues,
      })
      telemetry.query_tier2_calls = 1
      telemetry.query_input_tokens += tier2.inputTokens
      telemetry.query_output_tokens += tier2.outputTokens
      telemetry.query_compilation_cost += tier2.costEur
      if (tier2.status !== 'completed') {
        telemetry.query_compilation_status = 'failed'
        emitTelemetry()
        throw new Error('SEMANTIC_QUERY_COMPILATION_FAILED')
      }
      const adjudication = recordValue(tier2.input)
      const decision = String(adjudication.decision || '').trim()
      if (decision === 'clarification') {
        telemetry.query_compilation_status = 'clarification'
        emitTelemetry()
        return null
      }
      if (decision === 'patch') semanticInput = applySemanticPatch(semanticInput, adjudication.patch, issues)
      else if (decision !== 'accept') {
        telemetry.query_compilation_status = 'failed'
        emitTelemetry()
        return null
      }
      contract = completeSemanticContract(query, semanticInput)
      issues = semanticContractIssues(query, contract)
      if (issues.length > 0) {
        options.onDiagnostic?.({ stage: 'repair', issues })
        telemetry.query_compilation_status = 'failed'
        emitTelemetry()
        return null
      }
      planner = 'repaired_llm'
      finalModel = `${tier1Model}+${tier2Model}`
    }

    if (!contract) {
      emitTelemetry()
      return null
    }
    const parsed = safeParseCommercialSearchPlan(
      normalizePayload(semanticPlanEnvelope(query, contract), query, finalModel, options, planner),
    )
    if (!parsed.success) {
      const planIssues = parsed.error.issues.map((issue) => ({
        code: 'CONTRACT_VALIDATION_ERROR', path: issue.path.join('.'), message: issue.message,
      }))
      options.onDiagnostic?.({ stage: planner === 'llm' ? 'initial' : 'repair', issues: planIssues })
      emitTelemetry()
      return null
    }
    const planIssues = validateCommercialPlanSemantics(parsed.data)
    if (planIssues.length > 0) {
      options.onDiagnostic?.({ stage: planner === 'llm' ? 'initial' : 'repair', issues: planIssues })
      emitTelemetry()
      return null
    }
    telemetry.contract_hash = semanticContractHash(contract)
    telemetry.query_compilation_status = planner === 'llm' ? 'tier1_accepted' : 'tier2_patched'
    await setSemanticQueryCache(cacheKey, parsed.data)
    emitTelemetry()
    return parsed.data
  } catch (error) {
    telemetry.query_compilation_status = 'failed'
    emitTelemetry()
    throw error
  }
}
