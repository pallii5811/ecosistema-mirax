export type { MiraxSignalRequirement, SignalIntentSpec } from '@/lib/signal-intent/types'
export { EMPTY_SIGNAL_INTENT } from '@/lib/signal-intent/types'
export { SIGNAL_REQUIREMENT_META } from '@/lib/signal-intent/catalog'
export {
  parseSignalIntentHeuristic,
  mergeSignalIntent,
  coerceSignalIntent,
} from '@/lib/signal-intent/parse-heuristic'
export {
  leadMatchesSignalIntent,
  filterLeadsBySignalIntent,
  signalIntentToBusinessFilters,
  describeSignalIntent,
} from '@/lib/signal-intent/match-lead'
