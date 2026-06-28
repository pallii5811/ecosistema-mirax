export type { MiraxSignalRequirement, SignalIntentSpec } from '@/lib/signal-intent/types'
export { EMPTY_SIGNAL_INTENT } from '@/lib/signal-intent/types'
export { SIGNAL_REQUIREMENT_META } from '@/lib/signal-intent/catalog'
export {
  parseSignalIntentHeuristic,
  mergeSignalIntent,
  coerceSignalIntent,
} from '@/lib/signal-intent/parse-heuristic'
export {
  parseSignalIntent,
  parseSignalIntentOffline,
  intentSpecHasMatches,
} from '@/lib/signal-intent/parse-semantic'
export { inferFromSemanticGraph } from '@/lib/signal-intent/semantic-graph-fallback'
export {
  filterLeadsByIntentSpec,
  leadMatchesIntentSpec,
  intentTechnicalToLegacy,
} from '@/lib/signal-intent/apply-filters'
export {
  leadMatchesSignalIntent,
  filterLeadsBySignalIntent,
  signalIntentToBusinessFilters,
  describeSignalIntent,
} from '@/lib/signal-intent/match-lead'
