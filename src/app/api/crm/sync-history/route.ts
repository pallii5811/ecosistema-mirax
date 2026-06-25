import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/crm/sync-history?integrationId=...&limit=50&offset=0
 * Restituisce la cronologia degli invii al CRM (success/error) per l'utente corrente.
 * Se integrationId è omesso, restituisce TUTTI i log dell'utente.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ entries: [], error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const integrationId = url.searchParams.get('integrationId') || ''
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)

  let query = supabase
    .from('crm_sync_log')
    .select('id, integration_id, lead_website, lead_nome, status, error_message, created_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (integrationId) {
    query = query.eq('integration_id', integrationId)
  }

  const { data, error, count } = await query

  if (error) {
    return Response.json({ entries: [], total: 0, error: error.message }, { status: 500 })
  }

  return Response.json({
    entries: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  })
}
