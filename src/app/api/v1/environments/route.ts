import { NextRequest } from 'next/server'
import { apiError, apiResponse, authenticateApiKey } from '@/lib/api-auth'
import { createServiceRoleClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  const { userId, error } = await authenticateApiKey(req)
  if (error || !userId) return apiError(error || 'Unauthorized', 401)

  const supabase = createServiceRoleClient()

  const { data, error: qErr } = await supabase
    .from('environments')
    .select('id, name, description, stats, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (qErr) return apiError('Query failed', 500)

  return apiResponse({ data: data || [] })
}
