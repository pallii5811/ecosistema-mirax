/**
 * Seed relazioni segnali — mirror tabella Supabase signal_relationships (Fase 7.2).
 */

export type SignalRelationship = {
  signal_a_type: string
  signal_b_type: string
  relationship: 'reinforces' | 'contradicts' | 'enables'
  weight: number
  description: string
}

export const DEFAULT_SIGNAL_RELATIONSHIPS: SignalRelationship[] = [
  {
    signal_a_type: 'hiring',
    signal_b_type: 'crm_change',
    relationship: 'reinforces',
    weight: 0.9,
    description: 'Assumere + cambio CRM = forte intent di digital transformation',
  },
  {
    signal_a_type: 'funding_received',
    signal_b_type: 'expansion',
    relationship: 'reinforces',
    weight: 0.85,
    description: 'Funding + espansione = budget confermato',
  },
  {
    signal_a_type: 'tender_won',
    signal_b_type: 'hiring',
    relationship: 'enables',
    weight: 0.7,
    description: 'Vittoria gara richiede nuovo personale',
  },
  {
    signal_a_type: 'site_stale',
    signal_b_type: 'hiring',
    relationship: 'contradicts',
    weight: 0.4,
    description: 'Sito datato ma assumono = mixed signal',
  },
]
