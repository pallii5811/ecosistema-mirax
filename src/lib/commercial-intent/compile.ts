/**
 * Heuristic fallback only — NOT authoritative.
 * Use compileCommercialIntentSemantic() for product/runtime authority.
 */
export { compileCommercialIntentSpecHeuristic as compileCommercialIntentSpec } from './compile-heuristic'
export {
  compileCommercialIntentSemantic,
  compileAndPlanCommercialIntentAsync,
  type IntentCompilerTelemetry,
  type CompileCommercialIntentOptions,
} from './semantic-compile'
export { extractCommercialIntentHints } from './hints'
export { hasActorDirectionInversion } from './actor-direction'
export { commercialIntentSpecFromSearchPlan } from './map-from-search-plan'
