import ontologyJson from '../../../contracts/signal-ontology.v1.json'
import { z } from 'zod'
import { SOURCE_BY_ID } from '@/lib/source-intelligence/registry'

const SeedSchema = z.object({
  id: z.string().min(1), family: z.string().min(1), description: z.string().min(1),
  problems: z.array(z.string()).min(1), events: z.array(z.string()).min(1),
  sources: z.array(z.string()).min(1), preferred: z.array(z.string()).min(1),
  freshness_days: z.number().int().positive(), strength: z.number().min(0).max(1),
  risks: z.array(z.string()), hints: z.array(z.string()).min(1),
}).strict()
const OntologySchema = z.object({
  schema_version: z.literal('1.0.0'),
  aliases: z.record(z.string(), z.string()),
  signals: z.array(SeedSchema).min(1),
}).strict()

const parsed = OntologySchema.parse(ontologyJson)

export type SignalDefinition = {
  id: string
  family: string
  description: string
  applicableProblems: string[]
  relatedEvents: string[]
  likelySourceClasses: string[]
  preferredSourceClasses: string[]
  evidenceRules: string[]
  defaultFreshnessDays: number
  freshnessDecayFunction: 'exponential_half_life'
  defaultStrength: number
  falsePositiveRisks: string[]
  extractionHints: string[]
}

export const SIGNAL_ONTOLOGY_VERSION = parsed.schema_version
export const SIGNAL_ALIASES: Readonly<Record<string, string>> = Object.freeze(parsed.aliases)
export const SIGNAL_ONTOLOGY: readonly SignalDefinition[] = Object.freeze(parsed.signals.map((seed) => {
  for (const source of [...seed.sources, ...seed.preferred]) {
    if (!SOURCE_BY_ID.has(source)) throw new Error(`Signal ${seed.id} references unknown source ${source}`)
  }
  return Object.freeze({
    id: seed.id,
    family: seed.family,
    description: seed.description,
    applicableProblems: seed.problems,
    relatedEvents: seed.events,
    likelySourceClasses: seed.sources,
    preferredSourceClasses: seed.preferred,
    evidenceRules: [
      'source_url_required',
      'observed_at_required',
      'official_domain_required',
      'search_snippet_not_evidence',
    ],
    defaultFreshnessDays: seed.freshness_days,
    freshnessDecayFunction: 'exponential_half_life' as const,
    defaultStrength: seed.strength,
    falsePositiveRisks: seed.risks,
    extractionHints: seed.hints,
  })
}))
export const SIGNAL_BY_ID = new Map(SIGNAL_ONTOLOGY.map((signal) => [signal.id, signal]))

export function canonicalSignalId(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const canonical = SIGNAL_ALIASES[normalized] || normalized
  return SIGNAL_BY_ID.has(canonical) ? canonical : null
}

export function getSignalDefinition(value: string): SignalDefinition | null {
  const id = canonicalSignalId(value)
  return id ? SIGNAL_BY_ID.get(id) ?? null : null
}

export function signalOntologyPromptFragment(): string {
  return SIGNAL_ONTOLOGY.map((signal) => `${signal.id}: ${signal.description}`).join('\n')
}
