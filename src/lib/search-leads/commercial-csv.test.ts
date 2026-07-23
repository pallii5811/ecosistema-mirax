import { describe, expect, it } from 'vitest'
import { commercialLeadToCsvRow, commercialResultsToCsv, COMMERCIAL_CSV_HEADERS } from './commercial-csv'

describe('commercialResultsToCsv', () => {
  it('exports exactly three parity fields including canonical ids', () => {
    const leads = [
      {
        canonical_lead_id: '5105745d-2673-46cb-b1e0-246e34778ac8',
        azienda: 'Latterie Vicentine',
        sito: 'https://latterievicentine.it',
        email: 'comm.formaggi@latterievicentine.it',
        source_url: 'https://www.rainews.it/example',
        evidence_excerpt: 'nuovo stabilimento',
        why_now: 'production expansion',
        why_fit: '',
        market_scope_status: 'LIKELY_SME',
        claim_type: 'OBSERVED_EVENT',
        event_date: '2026-03-01',
      },
      {
        canonical_lead_id: 'e282e2bb-682c-43d3-a995-667f4adad5a6',
        azienda: 'Tecnoeka',
        sito: 'https://tecnoeka.com',
        email: 'info@tecnoeka.com',
        telefono: '+390495791479',
        source_url: 'https://www.tecnoeka.com/news/',
        evidence_excerpt: 'nuovo stabilimento',
        why_now: 'production expansion',
        market_scope_status: 'LIKELY_SME',
        claim_type: 'direct',
        event_date: '2026-07-20',
      },
      {
        canonical_lead_id: '3b3dfade-e2db-447d-bb31-76be67b5fba1',
        azienda: 'DalterFood Group',
        sito: 'https://dalterfood.com',
        telefono: '+390522901101',
        source_url: 'https://www.dalterfood.com/news/',
        evidence_excerpt: 'inaugura a Parma',
        why_now: 'production expansion',
        market_scope_status: 'LIKELY_SME',
        claim_type: 'OBSERVED_EVENT',
        event_date: '2026-02-02',
      },
    ]
    const csv = commercialResultsToCsv(leads)
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n')
    expect(lines).toHaveLength(4) // header + 3 data
    expect(lines[0]).toBe(COMMERCIAL_CSV_HEADERS.join(','))
    expect(csv).toContain('5105745d-2673-46cb-b1e0-246e34778ac8')
    expect(csv).toContain('latterievicentine.it')
    expect(csv).toContain('comm.formaggi@latterievicentine.it')
    expect(csv).not.toContain('rainews.it@')
    const row = commercialLeadToCsvRow(leads[2])
    expect(row.canonical_lead_id).toBe('3b3dfade-e2db-447d-bb31-76be67b5fba1')
    expect(row.dominio).toBe('dalterfood.com')
    expect(row.email).toBe('')
    expect(row.telefono).toBe('+390522901101')
  })
})
