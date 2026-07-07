/**
 * Universe SDK public API.
 */

export * from './types.ts'
export * from './errors.ts'
export * from './canonical.ts'

export {
  createEntity,
  upsertEntity,
  getEntityById,
  getEntityByCanonicalId,
  getEntityByAlias,
  listEntities,
  mergeEntities,
  type CreateEntityInput,
  type UpsertEntityInput,
} from './entity-repository.ts'

export {
  createObservation,
  createObservations,
  getLatestObservation,
  getTimeline,
  getObservationAtTime,
  type CreateObservationInput,
} from './observation-repository.ts'

export {
  createRelationship,
  createRelationships,
  getRelatedEntities,
  getSubgraph,
  type CreateRelationshipInput,
} from './relationship-repository.ts'

export {
  appendEvent,
  appendEvents,
  getEvents,
  markEventProcessed,
  type CreateEventInput,
} from './event-repository.ts'

export { ingestMiraxLead, type MiraxLeadInput } from './ingest-lead.ts'
export { ingestClayEnrichedLead } from './ingest-clay.ts'

export {
  executeUniverseQuery,
  buildNoPixelRomaQuery,
  buildHiringMilanoQuery,
  type UniverseQuery,
  type ObservationFilter,
  type RelationshipFilter,
} from './query-builder.ts'

export {
  signalIntentToUniverseQuery,
  executeAgenticUniverseSearch,
  commercialIntentToUniverseQuery,
  executeCommercialUniverseSearch,
  entityToMiraxLeadRow,
  type UniverseQueryIntent,
  type CommercialUniverseQueryIntent,
} from './agentic-search.ts'

export {
  isUniverseReadEnabled,
  hydrateLeadFromUniverse,
  hydrateLeadsFromUniverse,
} from './hydrate-leads.ts'

export {
  detectCommercialSignals,
  detectCommercialSignalsForEntity,
  loadEntityFacts,
  computeCommercialSignalStrength,
  type CommercialSignal,
  type CommercialSignalType,
  type CommercialSignalEvidence,
  type EntityFacts,
  type EntitySignalBundle,
} from './commercial-signals.ts'

export {
  buildCommercialOpportunities,
  buildOpportunityForEntity,
  rankOpportunities,
  topEvidence,
  formatOpportunityScore,
  type CommercialOpportunity,
} from './opportunity.ts'

export {
  recordFeedback,
  listFeedback,
  getEntityFeedbackBoostMap,
  applyFeedbackBoost,
  getUserFeedbackProfile,
  buildFeedbackPromptExamples,
  FEEDBACK_ACTION_WEIGHTS,
  feedbackActionToValue,
  type FeedbackAction,
  type FeedbackRecord,
  type FeedbackInput,
  type UserFeedbackProfile,
  type FeedbackPromptExample,
} from './feedback.ts'

export { buildDigitalTwin, type DigitalTwinSnapshot } from './digital-twin.ts'

export {
  listUserContextForEntity,
  upsertUserContext,
  deleteUserContext,
  type UserContextType,
} from './user-context-repository.ts'

export { getUniverseAnalytics, type UniverseAnalyticsSummary } from './analytics.ts'

export { processUniverseEventBatch, type UniverseEventProcessResult } from './event-consumer.ts'

export {
  buildUniverseCacheKey,
  getQueryCache,
  setQueryCache,
  purgeExpiredQueryCache,
  isUniverseCacheEnabled,
  cacheTtlSeconds,
  type UniverseCacheKind,
} from './query-cache.ts'

export { getUniverseAnalyticsCached } from './analytics-cache.ts'

export {
  dispatchUniverseEventAlerts,
  isUniverseAlertingEnabled,
  UNIVERSE_ALERT_TYPES,
} from './alerting.ts'

export {
  computeGraphRankScore,
  buildGraphRankFactors,
  rankUniverseEntities,
  type GraphRankFactors,
  type GraphRankResult,
} from './graph-ranking.ts'

export {
  dispatchUniverseEventWebhooks,
  isUniverseWebhooksEnabled,
  listWebhookDeliveries,
} from './webhooks.ts'

export { archiveOldUniverseEvents, universeArchiveDays } from './event-archive.ts'

export {
  getUniverseQualityMetrics,
  getSearchQualityMetrics,
  getUserLearningMetrics,
  type UniverseQualityMetrics,
  type SearchQualityMetrics,
} from './quality.ts'

export {
  getEntityPii,
  logPiiAccess,
  checkPiiAccessAllowed,
  entityToMiraxLeadRowWithPii,
  DEFAULT_PII_POLICY,
  type EntityPii,
  type PiiAccessType,
  type PiiAccessLog,
} from './pii.ts'
