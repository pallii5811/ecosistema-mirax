import { NextRequest } from 'next/server'
import { apiError, apiResponse, authenticateApiKey } from '@/lib/api-auth'
import { createServiceRoleClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  const { userId, error } = await authenticateApiKey(req)
  if (error || !userId) return apiError(error || 'Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const channel = searchParams.get('channel')
  const status = searchParams.get('status')
  const limit = Math.min(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 200)
  const page = Math.max(Number.parseInt(searchParams.get('page') || '1', 10) || 1, 1)

  const supabase = createServiceRoleClient()
  let q = supabase
    .from('outreach_log')
    .select('id, lead_name, lead_website, channel, status, mode, created_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (channel) q = q.eq('channel', channel)
  if (status) q = q.eq('status', status)

  const from = (page - 1) * limit
  const to = from + limit - 1
  const { data, error: qErr, count } = await q.range(from, to)

  if (qErr) {
    if (/outreach_log/i.test(qErr.message) && /does not exist/i.test(qErr.message)) {
      return apiResponse({ data: [], total: 0, page, limit, pages: 0, enabled: false })
    }
    return apiError('Query failed', 500)
  }

  const total = count ?? 0
  return apiResponse({
    data: data ?? [],
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  })
}
