export type LeadEnrichment = {
  id: string
  user_id: string
  lead_website: string
  linkedin_url: string | null
  instagram_url: string | null
  facebook_url: string | null
  partita_iva: string | null
  anno_fondazione: string | null
  dipendenti_stimati: string | null
  extra_data: Record<string, any>
  created_at: string
  updated_at: string
}
