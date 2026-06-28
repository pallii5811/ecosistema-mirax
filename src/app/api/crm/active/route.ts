import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(_: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ integration: null })

  const { data, error } = await supabase
    .from('crm_integrations')
    .select('id, type, name')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const list = Array.isArray(data) ? data : []
  const preferred =
    list.find((i) => i.type === 'hubspot') ??
    list.find((i) => i.type === 'salesforce') ??
    list.find((i) => i.type === 'webhook') ??
    null

  return Response.json({ integration: preferred })
}
