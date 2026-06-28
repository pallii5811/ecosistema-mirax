/**
 * Normalizza lead grezzi (ricerca, pipeline, API) in formato NOUS.
 */

import type { NousLead } from './types.ts'

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function buildOpportunityString(lead: Record<string, unknown>): string {
  return [
    !lead.meta_pixel && !lead.has_pixel ? 'No Pixel' : '',
    !lead.google_tag_manager && !lead.has_gtm ? 'No GTM' : '',
    Array.isArray(lead.seo_errors) && lead.seo_errors.length > 0 ? 'Errori SEO' : '',
  ]
    .filter(Boolean)
    .join(', ')
}

export function normalizeLead(raw: Record<string, unknown> | null | undefined): NousLead {
  const lead = raw && typeof raw === 'object' ? raw : {}
  const nome =
    str(lead.nome) || str(lead.azienda) || str(lead.name) || str(lead.lead_name) || ''
  const sito = str(lead.sito) || str(lead.website) || str(lead.lead_website) || ''
  const email = (str(lead.email) || str(lead.lead_email)).toLowerCase()
  const telefono = str(lead.telefono) || str(lead.phone) || str(lead.lead_phone) || ''
  const citta = str(lead.citta) || str(lead.city) || str(lead.lead_city) || ''
  const categoria = str(lead.categoria) || str(lead.category) || str(lead.lead_category) || ''
  const score = Number(lead.score ?? lead.lead_score ?? lead.opportunity_score) || 0

  return {
    nome,
    sito,
    email,
    telefono,
    citta,
    categoria,
    score,
    opportunita: {
      no_pixel: !lead.meta_pixel && !lead.has_pixel,
      no_gtm: !lead.google_tag_manager && !lead.has_gtm,
      errori_seo: Array.isArray(lead.seo_errors) ? lead.seo_errors.length : 0,
    },
    raw: lead,
  }
}

export function normalizeLeads(rawList: unknown[]): NousLead[] {
  if (!Array.isArray(rawList)) return []
  return rawList
    .filter((r) => r && typeof r === 'object')
    .map((r) => normalizeLead(r as Record<string, unknown>))
}
