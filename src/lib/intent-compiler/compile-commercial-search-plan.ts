import canonicalSchema from '../../../contracts/commercial-search-plan.schema.json'
import {
  COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION,
  safeParseCommercialSearchPlan,
  type CommercialSearchPlan,
} from '@/lib/contracts/commercial-search-plan'
import { SOURCE_BY_ID, sourceSupportsSignal } from '@/lib/source-intelligence/registry'
import { getSignalDefinition, signalOntologyPromptFragment } from '@/lib/signal-ontology/ontology'
import { parseSignalIntentHeuristic } from '@/lib/signal-intent/parse-heuristic'
import { inferSellerBuyerProfile } from '@/lib/signal-intent/seller-buyer-inference'

export const COMMERCIAL_INTENT_PROMPT_VERSION = 'commercial-intent-v1.1.0' as const

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

const SYSTEM_PROMPT = `You are the semantic intent compiler for MIRAX, a B2B sales-intelligence system.
Convert the user's commercial objective into the provided canonical plan. The user may describe what they SELL rather than the buyer category.

Reason causally: seller offer -> problem solved -> buyer condition -> recent triggering event -> observable signal -> best source class -> evidence needed.

Rules:
- Never invent companies, URLs, contacts or observed facts. This output is a research plan, not search results.
- The query can be Italian. If the user says "Sono un/una ...", that phrase identifies the SELLER, not the buyer.
- For seller-framed queries, seller.offer_category, products_or_services, problems_solved and preferred_buyer_roles MUST be explicit and non-empty.
- Never copy the full raw query into seller.offer_description. State only the offer actually sold.
- Every required buying signal MUST be connected to a concrete triggering event, a buyer problem, an implied need and a causal relevance_to_offer.
- Do not use placeholders such as "implicit commercial need", "need to be verified", "coherence with the user objective" or paraphrases of the raw query.
- preferred_buyer_roles are the people/functions likely to own the problem or buying decision (for example owner, CFO, operations, HR, IT), not generic invented contacts.
- The plan must explain why the observed event makes outreach timely. A target category alone is never a buying signal.
- Preserve literal geography, size and exclusions.
- Prefer local micro/small/medium businesses unless the user explicitly asks for enterprise.
- A seller category is not automatically the buyer industry.
- Use composable signal names, not vague labels such as "hot" or "interesting".
- Search snippets, directories and generic blogs are never publishable proof.
- Require official domain, source URL and observation date for publication.
- Use concise arrays and at most 5 strong commercial hypotheses.
- The plan must stay inside the supplied hard budget.
- Output only through the required tool.

AVAILABLE COMPOSABLE SIGNAL ONTOLOGY:
${signalOntologyPromptFragment()}`

const TOOL_NAME = 'submit_commercial_search_plan'

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
  const schema = structuredClone(canonicalSchema) as any
  if (!isSellerFramedQuery(query)) return schema
  const seller = schema.$defs.seller.properties
  seller.offer_category = { type: 'string', minLength: 1, maxLength: 200 }
  seller.products_or_services.minItems = 1
  seller.problems_solved.minItems = 1
  seller.preferred_buyer_roles.minItems = 1
  schema.$defs.commercialHypothesis.properties.triggering_events.minItems = 1
  schema.$defs.commercialHypothesis.properties.signals.minItems = 1
  schema.$defs.signalPolicy.properties.required_signals.minItems = 1
  return schema
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
    maximum_llm_evaluations: Math.min(8, Math.max(2, Math.ceil(requestedLeadCount / 250))),
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
  const requiredSignals = [...new Set([
    ...canonicalSignals(signalPolicy.required_signals),
    ...deterministicSignalFloor,
  ])]
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
    if (!definition || normalizedSellerProducts.length === 0 || normalizedSellerProblems.length === 0) continue
    const buyerCondition = definition.applicableProblems[0]
    const sellerProblem = normalizedSellerProblems[0]
    const product = normalizedSellerProducts[0]
    causalHypotheses.push({
      id: `ontology-${signal}`,
      buyer_problem: `Il buyer affronta ${buyerCondition}; il seller risolve ${sellerProblem}.`,
      triggering_events: definition.relatedEvents.slice(0, 3),
      signals: [signal],
      implied_need: `Valutare ${product} per gestire ${buyerCondition} nel momento in cui il segnale viene verificato.`,
      relevance_to_offer: `${definition.description} rende attuale ${sellerProblem} e giustifica la valutazione di ${product}.`,
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
  const targetGeographies = stringArray(target.geographies)
  const targetExcludedAttributes = stringArray(target.excluded_attributes)
  target.geographies = targetGeographies
  target.required_attributes = stringArray(target.required_attributes)
  target.excluded_attributes = targetExcludedAttributes
  target.excluded_entities = stringArray(target.excluded_entities)
  target.local_business_preference = target.local_business_preference === true
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
    detect_technologies: audit.detect_technologies === true,
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

async function callCompiler(
  query: string,
  model: string,
  apiKey: string,
  options: CommercialIntentCompilerOptions,
  callKind: 'initial' | 'repair',
  repairIssues?: PlanValidationIssue[],
): Promise<unknown | null> {
  const repair = repairIssues?.length
    ? `\nThe previous plan failed validation. Repair only these errors:\n${repairIssues
        .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
        .join('\n')}`
    : ''
  const searchId = options.searchId
  const meter = options.costMeter
  if (!searchId || !meter) {
    console.warn('[commercial-intent-compiler] paid_call_blocked_without_cost_governor')
    return null
  }
  const idempotencyKey = `intent:${COMMERCIAL_INTENT_PROMPT_VERSION}:${callKind}`
  const configuredMax = Number(process.env.ANTHROPIC_COMPILER_MAX_CALL_EUR || 0.05)
  const estimatedCostEur = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 0.05
  const reservation = await meter.reserve({
    searchId,
    idempotencyKey,
    operationType: 'intent_compilation',
    estimatedCostEur,
    provider: 'anthropic',
    model,
    metadata: { call_kind: callKind, prompt_version: COMMERCIAL_INTENT_PROMPT_VERSION },
  })
  if (
    reservation &&
    typeof reservation === 'object' &&
    'status' in reservation &&
    String((reservation as { status?: unknown }).status || 'reserved') !== 'reserved'
  ) {
    console.warn('[commercial-intent-compiler] idempotency_hit_without_cached_payload')
    return null
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
      max_tokens: 1_600,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Submit the canonical MIRAX commercial search plan.',
          input_schema: compilerToolSchema(query),
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: `Commercial objective:\n${query}${repair}` }],
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
    await meter.settle(searchId, idempotencyKey, estimatedCostEur, {
      outcome: 'provider_http_error',
      http_status: response.status,
    })
    console.warn('[commercial-intent-compiler] provider_http_error', { status: response.status })
    return null
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; name?: string; input?: unknown }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const inputTokens = Math.max(0, Number(data.usage?.input_tokens || 0))
  const outputTokens = Math.max(0, Number(data.usage?.output_tokens || 0))
  const inputRate = Number(process.env.ANTHROPIC_INPUT_EUR_PER_MILLION || 0)
  const outputRate = Number(process.env.ANTHROPIC_OUTPUT_EUR_PER_MILLION || 0)
  const metered = inputRate > 0 && outputRate > 0
  const actualCostEur = metered
    ? (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
    : estimatedCostEur
  await meter.settle(searchId, idempotencyKey, actualCostEur, {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    pricing_mode: metered ? 'configured_token_rates' : 'conservative_reservation',
  })
  return data.content?.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME)?.input ?? null
}

export async function compileCommercialSearchPlan(
  query: string,
  options: CommercialIntentCompilerOptions = {},
): Promise<CommercialSearchPlan | null> {
  if (disabledFlag(process.env.UQE_ANTHROPIC_ENABLED)) return null
  const apiKey = cleanProviderEnv(process.env.ANTHROPIC_API_KEY)
  if (!apiKey) return null
  const model = cleanProviderEnv(
    process.env.UQE_ANTHROPIC_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.SEMANTIC_MODEL ||
    'claude-sonnet-5',
  )

  const firstRaw = await callCompiler(query, model, apiKey, options, 'initial')
  if (!firstRaw) return null
  const first = safeParseCommercialSearchPlan(normalizePayload(firstRaw, query, model, options, 'llm'))
  const firstIssues = first.success
    ? validateCommercialPlanSemantics(first.data)
    : first.error.issues.map((issue) => ({
        code: 'CONTRACT_VALIDATION_ERROR',
        path: issue.path.join('.'),
        message: issue.message,
      }))
  if (firstIssues.length > 0) options.onDiagnostic?.({ stage: 'initial', issues: firstIssues })
  if (first.success && firstIssues.length === 0) return first.data

  if (options.allowRepair === false) return null

  const repairedRaw = await callCompiler(query, model, apiKey, options, 'repair', firstIssues)
  if (!repairedRaw) return null
  const repaired = safeParseCommercialSearchPlan(
    normalizePayload(repairedRaw, query, model, options, 'repaired_llm'),
  )
  if (!repaired.success) {
    options.onDiagnostic?.({
      stage: 'repair',
      issues: repaired.error.issues.map((issue) => ({
        code: 'CONTRACT_VALIDATION_ERROR',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return null
  }
  const repairedIssues = validateCommercialPlanSemantics(repaired.data)
  if (repairedIssues.length > 0) options.onDiagnostic?.({ stage: 'repair', issues: repairedIssues })
  return repairedIssues.length === 0 ? repaired.data : null
}
