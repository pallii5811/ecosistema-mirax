import { z } from 'zod'

export const COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION = '1.0.0' as const

const cleanString = z.string().trim().min(1).max(500)
const uniqueStrings = z.array(cleanString).max(100).transform((items) => [...new Set(items)])

export const SemanticQueryContractSchema = z
  .object({
    original_query: z.string().trim().min(1).max(4000).optional(),
    query_goal: z.string().trim().min(1).max(1000),
    seller: z.record(z.string(), z.unknown()),
    offer: z.record(z.string(), z.unknown()),
    target_entity_types: uniqueStrings,
    target_company_description: z.string().trim().min(1).max(2000),
    event_or_state_description: z.string().trim().min(1).max(2000),
    target_role_in_event: z.string().trim().min(1).max(200),
    required_relationships: uniqueStrings,
    optional_relationships: uniqueStrings,
    excluded_roles: uniqueStrings,
    excluded_entities: uniqueStrings,
    geography: uniqueStrings,
    industry: uniqueStrings,
    size_constraints: z.record(z.string(), z.unknown()),
    temporal_constraints: z.record(z.string(), z.unknown()),
    positive_conditions: uniqueStrings,
    negative_conditions: uniqueStrings,
    must_have_facts: uniqueStrings,
    forbidden_inferences: uniqueStrings,
    data_requirements: uniqueStrings,
    ranking_objective: z.string().trim().min(1).max(1000),
    acceptance_rubric: uniqueStrings,
    discovery_hypotheses: z.array(z.record(z.string(), z.unknown())).max(20),
    clarification_required: z.boolean(),
    confidence: z.number().min(0).max(1),
    canonical_signal_hints: uniqueStrings,
  })
  .strict()

export type SemanticQueryContract = z.infer<typeof SemanticQueryContractSchema>

const optionalRange = z
  .object({ min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional() })
  .strict()
  .optional()
  .superRefine((range, ctx) => {
    if (range?.min !== undefined && range.max !== undefined && range.min > range.max) {
      ctx.addIssue({ code: 'custom', message: 'min must be less than or equal to max' })
    }
  })

const optionalMoneyRange = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  })
  .strict()
  .optional()
  .superRefine((range, ctx) => {
    if (range?.min !== undefined && range.max !== undefined && range.min > range.max) {
      ctx.addIssue({ code: 'custom', message: 'min must be less than or equal to max' })
    }
  })

export const CommercialSearchPlanSchema = z
  .object({
    schema_version: z.literal(COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION),
    search_id: z.string().trim().min(1).max(128),
    raw_query: z.string().trim().min(2).max(4000),
    language: z.string().trim().min(2).max(16),
    seller: z
      .object({
        offer_category: z.string().trim().max(200).nullable().optional(),
        offer_description: z.string().trim().min(1).max(1000),
        products_or_services: uniqueStrings,
        problems_solved: uniqueStrings,
        sales_motion: z.string().trim().max(200).nullable().optional(),
        preferred_buyer_roles: uniqueStrings,
      })
      .strict(),
    target: z
      .object({
        entity_types: uniqueStrings,
        industries: uniqueStrings,
        company_sizes: uniqueStrings,
        employee_range: optionalRange,
        revenue_range: optionalMoneyRange,
        geographies: uniqueStrings,
        local_business_preference: z.boolean(),
        required_attributes: uniqueStrings,
        excluded_attributes: uniqueStrings,
        excluded_entities: uniqueStrings,
      })
      .strict(),
    commercial_hypotheses: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(100),
            buyer_problem: z.string().trim().min(1).max(1000),
            triggering_events: uniqueStrings,
            signals: uniqueStrings,
            implied_need: z.string().trim().min(1).max(1000),
            relevance_to_offer: z.string().trim().min(1).max(1000),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    signal_policy: z
      .object({
        required_signals: uniqueStrings,
        optional_signals: uniqueStrings,
        negative_signals: uniqueStrings,
        maximum_age_days_by_signal: z.record(z.string(), z.number().int().min(1).max(3650)),
        minimum_signal_confidence: z.number().min(0).max(1),
      })
      .strict(),
    source_policy: z
      .object({
        preferred_source_classes: uniqueStrings,
        allowed_source_classes: uniqueStrings,
        excluded_source_classes: uniqueStrings,
        minimum_independent_sources: z.number().int().min(1).max(5),
        primary_source_required_for: uniqueStrings,
      })
      .strict(),
    evidence_policy: z
      .object({
        require_official_domain: z.boolean(),
        require_source_url: z.boolean(),
        require_observed_at: z.boolean(),
        minimum_evidence_confidence: z.number().min(0).max(1),
        corroboration_required_above_risk: z.number().min(0).max(1),
      })
      .strict(),
    audit_policy: z
      .object({
        modules: uniqueStrings,
        crawl_depth: z.number().int().min(0).max(5),
        maximum_pages: z.number().int().min(1).max(100),
        collect_contacts: z.boolean(),
        collect_social_profiles: z.boolean(),
        detect_technologies: z.boolean(),
        detect_commercial_signals: z.boolean(),
      })
      .strict(),
    ranking_policy: z
      .object({
        weight_buyer_fit: z.number().min(0).max(1),
        weight_signal_strength: z.number().min(0).max(1),
        weight_freshness: z.number().min(0).max(1),
        weight_evidence_confidence: z.number().min(0).max(1),
        weight_contactability: z.number().min(0).max(1),
        weight_need_gap: z.number().min(0).max(1),
      })
      .strict(),
    budget_policy: z
      .object({
        target_cost_eur: z.number().nonnegative(),
        hard_cost_eur: z.number().positive(),
        maximum_search_calls: z.number().int().min(0).max(10_000),
        maximum_pages_opened: z.number().int().min(0).max(100_000),
        maximum_llm_evaluations: z.number().int().min(0).max(10_000),
      })
      .strict(),
    ambiguity: z
      .object({
        score: z.number().min(0).max(1),
        assumptions: uniqueStrings,
        unresolved_fields: uniqueStrings,
      })
      .strict(),
    planner_metadata: z
      .object({
        planner: z.enum(['llm', 'heuristic_fallback', 'repaired_llm']),
        prompt_version: z.string().trim().min(1).max(100),
        model: z.string().trim().max(200).nullable(),
        generated_at: z.iso.datetime(),
      })
      .strict(),
    semantic_query_contract: SemanticQueryContractSchema.optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.budget_policy.target_cost_eur > plan.budget_policy.hard_cost_eur) {
      ctx.addIssue({
        code: 'custom',
        path: ['budget_policy', 'target_cost_eur'],
        message: 'target_cost_eur cannot exceed hard_cost_eur',
      })
    }
    const weightSum = Object.values(plan.ranking_policy).reduce((sum, value) => sum + value, 0)
    if (Math.abs(weightSum - 1) > 0.001) {
      ctx.addIssue({
        code: 'custom',
        path: ['ranking_policy'],
        message: `ranking weights must sum to 1 (received ${weightSum})`,
      })
    }
  })

export type CommercialSearchPlan = z.infer<typeof CommercialSearchPlanSchema>

export function parseCommercialSearchPlan(input: unknown): CommercialSearchPlan {
  return CommercialSearchPlanSchema.parse(input)
}

export function safeParseCommercialSearchPlan(input: unknown) {
  return CommercialSearchPlanSchema.safeParse(input)
}
