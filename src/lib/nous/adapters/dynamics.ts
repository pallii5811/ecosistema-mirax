import type { AdapterDispatchInput, LeadDispatchResult, NousAdapter } from '../types.ts'

const NOT_READY = 'Adapter MS Dynamics in arrivo (Blocco 7 — futuro)'

export const dynamicsAdapter: NousAdapter = {
  type: 'dynamics',
  async dispatch(input: AdapterDispatchInput): Promise<LeadDispatchResult[]> {
    return input.leads.map((l, index) => ({
      index,
      lead_nome: l.nome,
      status: 'error',
      error: NOT_READY,
    }))
  },
}
