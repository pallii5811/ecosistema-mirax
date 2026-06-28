'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { retrainUserScoringModel } from '@/lib/scoring-feedback'
import type { LeadInteraction, ScoringWeights, UserScoringModel } from '@/types/scoring'

export async function trackInteraction(
  leadWebsite: string,
  leadNome: string,
  action: LeadInteraction['action'],
  scoreAtTime?: number
): Promise<{ success: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false }

  const website = typeof leadWebsite === 'string' ? leadWebsite.trim() : ''
  if (!website) return { success: false }

  await supabase.from('lead_interactions').insert({
    user_id: user.id,
    lead_website: website,
    lead_nome: typeof leadNome === 'string' ? leadNome : null,
    action,
    score_at_time: typeof scoreAtTime === 'number' ? scoreAtTime : null,
  })

  if (action === 'converted' || action === 'rejected') {
    await retrainUserScoringModel(supabase, user.id)
    revalidatePath('/dashboard/stats')
  }

  return { success: true }
}

export async function getUserModel(): Promise<UserScoringModel | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase.from('user_scoring_models').select('*').eq('user_id', user.id).maybeSingle()

  if (error) {
    console.error('getUserModel error:', error)
  }

  if (data) return data as UserScoringModel

  const { data: newModel, error: insertError } = await supabase
    .from('user_scoring_models')
    .insert({ user_id: user.id })
    .select('*')
    .single()

  if (insertError) {
    console.error('create default model error:', insertError)
    return null
  }

  return newModel as UserScoringModel
}

export async function calculatePersonalizedScore(lead: {
  meta_pixel?: boolean
  has_pixel?: boolean
  google_tag_manager?: boolean
  has_gtm?: boolean
  has_ssl?: boolean
  email?: string
  seo_errors?: any[]
  load_speed_seconds?: number
  has_google_ads?: boolean
}): Promise<number> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let weights: ScoringWeights = {
    weight_no_pixel: 25,
    weight_no_gtm: 15,
    weight_no_ssl: 10,
    weight_has_email: 20,
    weight_seo_errors: 15,
    weight_slow_speed: 10,
    weight_no_google_ads: 5,
  }

  if (user) {
    const { data: model } = await supabase.from('user_scoring_models').select('*').eq('user_id', user.id).maybeSingle()
    if (model) {
      weights = {
        weight_no_pixel: Number((model as any).weight_no_pixel ?? weights.weight_no_pixel),
        weight_no_gtm: Number((model as any).weight_no_gtm ?? weights.weight_no_gtm),
        weight_no_ssl: Number((model as any).weight_no_ssl ?? weights.weight_no_ssl),
        weight_has_email: Number((model as any).weight_has_email ?? weights.weight_has_email),
        weight_seo_errors: Number((model as any).weight_seo_errors ?? weights.weight_seo_errors),
        weight_slow_speed: Number((model as any).weight_slow_speed ?? weights.weight_slow_speed),
        weight_no_google_ads: Number((model as any).weight_no_google_ads ?? weights.weight_no_google_ads),
      }
    }
  }

  let score = 0
  const hasPixel = lead.meta_pixel === true || lead.has_pixel === true
  const hasGtm = lead.google_tag_manager === true || lead.has_gtm === true

  if (!hasPixel) score += weights.weight_no_pixel
  if (!hasGtm) score += weights.weight_no_gtm
  if (lead.has_ssl === false) score += weights.weight_no_ssl
  if (typeof lead.email === 'string' && lead.email.trim()) score += weights.weight_has_email
  if (Array.isArray(lead.seo_errors) && lead.seo_errors.length > 0) score += weights.weight_seo_errors
  if (typeof lead.load_speed_seconds === 'number' && lead.load_speed_seconds > 3) score += weights.weight_slow_speed
  if (lead.has_google_ads === false) score += weights.weight_no_google_ads

  return Math.min(Math.round(score), 100)
}

export async function getConversionStats(): Promise<{
  total_contacted: number
  total_converted: number
  total_rejected: number
  conversion_rate: number
  best_categories: { category: string; rate: number }[]
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user)
    return {
      total_contacted: 0,
      total_converted: 0,
      total_rejected: 0,
      conversion_rate: 0,
      best_categories: [],
    }

  const { data, error } = await supabase.from('lead_interactions').select('*').eq('user_id', user.id)

  if (error) {
    console.error('getConversionStats error:', error)
    return {
      total_contacted: 0,
      total_converted: 0,
      total_rejected: 0,
      conversion_rate: 0,
      best_categories: [],
    }
  }

  const contacted = data?.filter((i: any) => i.action === 'contacted').length || 0
  const converted = data?.filter((i: any) => i.action === 'converted').length || 0
  const rejected = data?.filter((i: any) => i.action === 'rejected').length || 0

  return {
    total_contacted: contacted,
    total_converted: converted,
    total_rejected: rejected,
    conversion_rate: contacted > 0 ? Math.round((converted / contacted) * 100) : 0,
    best_categories: [],
  }
}
