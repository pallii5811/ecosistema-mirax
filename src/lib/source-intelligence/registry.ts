import sourceRegistryJson from '../../../contracts/source-registry.v1.json'
import { z } from 'zod'

const SourceDefinitionSchema = z.object({
  id: z.string().min(1),
  implementation_id: z.string().min(1).optional(),
  capability_version: z.string().min(1).optional(),
  runtime_coverage: z.enum(['supported', 'unsupported', 'generic_fallback_partial']).optional(),
  signals_supported: z.array(z.string()),
  trust_level: z.number().min(0).max(1),
  primary: z.boolean(),
  cost_eur_per_operation: z.number().nonnegative(),
  access_method: z.string().min(1),
  geographic_coverage: z.array(z.string()).min(1),
  freshness_days: z.number().int().nonnegative(),
  rate_limit_per_minute: z.number().int().positive(),
  extraction_method: z.string().min(1),
  false_positive_risks: z.array(z.string()),
  corroboration_required: z.boolean(),
  publishable_alone: z.boolean(),
}).strict()

const SourceRegistrySchema = z.object({
  schema_version: z.literal('1.0.0'),
  sources: z.array(SourceDefinitionSchema).min(1),
}).strict()

export type SourceDefinition = z.infer<typeof SourceDefinitionSchema>
export const SOURCE_REGISTRY = SourceRegistrySchema.parse(sourceRegistryJson)
export const SOURCE_BY_ID = new Map(SOURCE_REGISTRY.sources.map((source) => [source.id, source]))

export function sourceRuntimeCoverage(sourceId: string): 'supported' | 'unsupported' | 'generic_fallback_partial' {
  const source = SOURCE_BY_ID.get(sourceId)
  if (!source?.implementation_id || !source.capability_version) return 'unsupported'
  return source.runtime_coverage || 'unsupported'
}

export function sourceSupportsSignal(sourceId: string, signal: string): boolean {
  const source = SOURCE_BY_ID.get(sourceId)
  return Boolean(source?.signals_supported.includes('*') || source?.signals_supported.includes(signal))
}

export function canSourcePublishEvidence(sourceId: string, signal: string): boolean {
  const source = SOURCE_BY_ID.get(sourceId)
  return Boolean(source && source.publishable_alone && sourceSupportsSignal(sourceId, signal))
}

export function estimatedSourceCost(sourceIds: string[]): number {
  return sourceIds.reduce((sum, id) => sum + (SOURCE_BY_ID.get(id)?.cost_eur_per_operation ?? 0), 0)
}
