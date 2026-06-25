export type LeadInteraction = {
  id: string
  user_id: string
  lead_website: string
  lead_nome: string | null
  action: 'viewed' | 'contacted' | 'converted' | 'rejected'
  score_at_time: number | null
  notes: string | null
  created_at: string
}

export type UserScoringModel = {
  id: string
  user_id: string
  weight_no_pixel: number
  weight_no_gtm: number
  weight_no_ssl: number
  weight_has_email: number
  weight_seo_errors: number
  weight_slow_speed: number
  weight_no_google_ads: number
  total_conversions: number
  total_rejections: number
  last_trained_at: string | null
  updated_at: string
}

export type ScoringWeights = {
  weight_no_pixel: number
  weight_no_gtm: number
  weight_no_ssl: number
  weight_has_email: number
  weight_seo_errors: number
  weight_slow_speed: number
  weight_no_google_ads: number
}
