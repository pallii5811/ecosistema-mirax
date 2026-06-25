'use server'

import { createClient } from '@/utils/supabase/server'
import type { LeadEnrichment } from '@/types/enrichment'

export async function getEnrichment(website: string): Promise<LeadEnrichment | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const site = typeof website === 'string' ? website.trim() : ''
  if (!site) return null

  const { data, error } = await supabase
    .from('lead_enrichments')
    .select('*')
    .eq('user_id', user.id)
    .eq('lead_website', site)
    .maybeSingle()

  if (error) {
    console.error('getEnrichment error:', error)
    return null
  }

  return (data as LeadEnrichment) || null
}

export async function saveEnrichment(
  website: string,
  enrichmentData: Omit<LeadEnrichment, 'id' | 'user_id' | 'lead_website' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; data?: LeadEnrichment; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, error: 'Non autenticato' }

  const site = typeof website === 'string' ? website.trim() : ''
  if (!site) return { success: false, error: 'Sito mancante' }

  const payload = {
    user_id: user.id,
    lead_website: site,
    linkedin_url: enrichmentData.linkedin_url,
    instagram_url: enrichmentData.instagram_url,
    facebook_url: enrichmentData.facebook_url,
    partita_iva: enrichmentData.partita_iva,
    anno_fondazione: enrichmentData.anno_fondazione,
    dipendenti_stimati: enrichmentData.dipendenti_stimati,
    extra_data: enrichmentData.extra_data ?? {},
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('lead_enrichments')
    .upsert(payload as any, { onConflict: 'user_id,lead_website' })
    .select('*')
    .single()

  if (error) {
    console.error('saveEnrichment error:', error)
    return { success: false, error: error.message }
  }

  return { success: true, data: data as LeadEnrichment }
}
