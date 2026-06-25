export type EnvironmentListSummary = {
  id: string
  name: string
  description: string | null
  created_at: string
  leadsCount: number
}

export type Environment = {
  id: string
  user_id: string
  name: string
  description: string | null
  icon: string
  color: string
  lead_ids: string[]
  search_ids: string[]
  filters: EnvironmentFilters
  stats: EnvironmentStats
  is_auto_update: boolean
  created_at: string
  updated_at: string
}

export type EnvironmentFilters = {
  no_pixel?: boolean
  no_gtm?: boolean
  no_ssl?: boolean
  min_score?: number
  max_score?: number
  categories?: string[]
  cities?: string[]
}

export type EnvironmentStats = {
  total_leads: number
  avg_score: number
  leads_with_email: number
  leads_with_phone: number
  leads_no_pixel: number
  leads_no_gtm: number
  top_categories: { name: string; count: number }[]
  top_cities: { name: string; count: number }[]
}

export type CreateEnvironmentInput = {
  name: string
  description?: string
  icon?: string
  color?: string
  lead_ids?: string[]
  search_ids?: string[]
  filters?: EnvironmentFilters
}

export type UpdateEnvironmentInput = Partial<CreateEnvironmentInput> & {
  id: string
}
