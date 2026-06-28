/**
 * NOUS — Integration Object layer (Blocco 7).
 * Tipi condivisi tra adapter CRM, webhook e API enterprise.
 */

export type NousIntegrationType = 'webhook' | 'hubspot' | 'salesforce' | 'dynamics' | 'vtiger'

export type NousLead = {
  nome: string
  sito: string
  email: string
  telefono: string
  citta: string
  categoria: string
  score: number
  opportunita: {
    no_pixel: boolean
    no_gtm: boolean
    errori_seo: number
  }
  raw: Record<string, unknown>
}

export type CrmIntegrationRow = {
  id: string
  type: string
  config: Record<string, unknown>
  leads_synced?: number
}

export type LeadDispatchResult = {
  index: number
  lead_nome: string
  status: 'success' | 'error'
  error?: string
  external_id?: string
}

export type DispatchLeadsResult = {
  ok: boolean
  total: number
  success: number
  failed: number
  results: LeadDispatchResult[]
}

export type AdapterDispatchInput = {
  integration: CrmIntegrationRow
  event: string
  leads: NousLead[]
}

export type NousAdapter = {
  type: NousIntegrationType
  dispatch: (input: AdapterDispatchInput) => Promise<LeadDispatchResult[]>
}
