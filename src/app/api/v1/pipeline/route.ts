import { NextRequest } from 'next/server'
import { apiError, apiResponse, authenticateApiKey } from '@/lib/api-auth'
import { createServiceRoleClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  const { userId, error } = await authenticateApiKey(req)
  if (error || !userId) return apiError(error || 'Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const stage = searchParams.get('stage')
  const limit = Math.min(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 200)
  const page = Math.max(Number.parseInt(searchParams.get('page') || '1', 10) || 1, 1)

  const supabase = createServiceRoleClient()
  let q = supabase
    .from('lead_pipeline')
    .select(
      'id, stage, deal_value, lead_name, lead_website, lead_city, lead_category, lead_score, created_at, updated_at',
      { count: 'exact' },
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (stage) q = q.eq('stage', stage)

  const from = (page - 1) * limit
  const to = from + limit - 1
  const { data, error: qErr, count } = await q.range(from, to)

  if (qErr) return apiError('Query failed', 500)

  const total = count ?? 0
  return apiResponse({
    data: data ?? [],
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  })
}
