/**
 * Stage 1 frozen product capability matrix.
 * Truthfulness only — does not change discovery, ranking, or adapters.
 */

export type Stage1CapabilityStatus =
  | 'SUPPORTED'
  | 'SUPPORTED_PARTIAL'
  | 'BETA'
  | 'UNAVAILABLE'

export type Stage1CapabilityId =
  | 'digital_audit'
  | 'hiring_sales'
  | 'hiring_marketing'
  | 'procurement'
  | 'growth_expansion'
  | 'other'

export type Stage1Capability = {
  id: Stage1CapabilityId
  label: string
  status: Stage1CapabilityStatus
  customer_visible: boolean
  limits: string
  signal_hints: readonly string[]
}

export const STAGE1_CAPABILITY_MATRIX: readonly Stage1Capability[] = [
  {
    id: 'digital_audit',
    label: 'Digital Audit',
    status: 'SUPPORTED',
    customer_visible: true,
    limits: 'Ricerca locale Maps + audit sito. Target e copertura dipendono da zona e categoria.',
    signal_hints: [],
  },
  {
    id: 'hiring_sales',
    label: 'Hiring Sales',
    status: 'SUPPORTED_PARTIAL',
    customer_visible: true,
    limits: 'Può esaurire le fonti prima del target. Risultati parziali sono attesi e non vengono riempiti artificialmente.',
    signal_hints: ['hiring_sales', 'hiring_commercial'],
  },
  {
    id: 'hiring_marketing',
    label: 'Hiring Marketing',
    status: 'SUPPORTED_PARTIAL',
    customer_visible: true,
    limits: 'Può esaurire le fonti prima del target. Risultati parziali sono attesi e non vengono riempiti artificialmente.',
    signal_hints: ['hiring_marketing'],
  },
  {
    id: 'procurement',
    label: 'Procurement / Gare',
    status: 'SUPPORTED_PARTIAL',
    customer_visible: true,
    limits: 'ANAC supportata in modo parziale; TED e risoluzione dominio restano limitati. Nessun padding dei risultati.',
    signal_hints: ['tender_won', 'procurement'],
  },
  {
    id: 'growth_expansion',
    label: 'Growth / Espansione',
    status: 'SUPPORTED_PARTIAL',
    customer_visible: true,
    limits: 'Resa discovery limitata. Solo aziende operative verificate; associazioni/enti/directory esclusi.',
    signal_hints: ['expansion', 'new_location', 'geographic_expansion', 'production_expansion'],
  },
  {
    id: 'other',
    label: 'Altre capability',
    status: 'BETA',
    customer_visible: false,
    limits: 'Non certificate per Stage 1. Non dichiarate universali né vendibili come complete.',
    signal_hints: [],
  },
] as const

export function stage1CapabilityById(id: Stage1CapabilityId): Stage1Capability {
  const found = STAGE1_CAPABILITY_MATRIX.find((item) => item.id === id)
  if (!found) throw new Error(`unknown stage1 capability: ${id}`)
  return found
}

export function resolveStage1CapabilityFromSignals(signals: readonly string[]): Stage1Capability {
  const normalized = new Set(
    signals.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean),
  )
  for (const capability of STAGE1_CAPABILITY_MATRIX) {
    if (capability.id === 'other' || capability.id === 'digital_audit') continue
    if (capability.signal_hints.some((hint) => normalized.has(hint))) return capability
  }
  if (normalized.size === 0) return stage1CapabilityById('digital_audit')
  // Unknown exclusive signals → beta/unavailable lane, never claim full support.
  return stage1CapabilityById('other')
}

export function stage1StatusIsSellable(status: Stage1CapabilityStatus): boolean {
  return status === 'SUPPORTED' || status === 'SUPPORTED_PARTIAL'
}

export function stage1UserMessage(capability: Stage1Capability): string {
  if (capability.status === 'SUPPORTED') {
    return capability.limits
  }
  if (capability.status === 'SUPPORTED_PARTIAL') {
    return `Capability in modalità ${capability.status}: ${capability.limits}`
  }
  if (capability.status === 'UNAVAILABLE') {
    return `Capability non disponibile in Stage 1: ${capability.limits}`
  }
  return `Capability in BETA (non certificata): ${capability.limits}`
}

export function stage1SearchOutcomeStatus(
  capability: Stage1Capability,
  opts: { brakeEngaged?: boolean; found?: number; target?: number } = {},
): 'completed' | 'partial' | 'unavailable' | 'pending' {
  if (opts.brakeEngaged) return 'unavailable'
  if (capability.status === 'UNAVAILABLE' || capability.status === 'BETA') return 'unavailable'
  if (
    capability.status === 'SUPPORTED_PARTIAL' &&
    typeof opts.found === 'number' &&
    typeof opts.target === 'number' &&
    opts.target > 0 &&
    opts.found < opts.target
  ) {
    return 'partial'
  }
  return 'completed'
}
