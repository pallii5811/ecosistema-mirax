import { NextRequest } from 'next/server'
import { apiError, apiResponse, generateApiKey, requireUserSession } from '@/lib/api-auth'

export async function GET(_: NextRequest) {
  const { supabase, user } = await requireUserSession()
  if (!user) return apiError('Unauthorized', 401)

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key_prefix, name, is_active, requests_count, last_used_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return apiError(error.message || 'Query failed', 500)

  return apiResponse({ data: data || [] })
}

export async function POST(req: NextRequest) {
  const { supabase, user } = await requireUserSession()
  if (!user) return apiError('Unauthorized', 401)

  const body = (await req.json().catch(() => null)) as { name?: string } | null
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'My API Key'

  const { key, hash, prefix } = generateApiKey()

  const { error } = await supabase.from('api_keys').insert({
    user_id: user.id,
    key_hash: hash,
    key_prefix: prefix,
    name,
  })

  if (error) return apiError(error.message || 'Insert failed', 500)

  return apiResponse(
    {
      key,
      prefix,
      name,
      message: 'Salva questa chiave: non verrà mostrata di nuovo',
    },
    201
  )
}

export async function DELETE(req: NextRequest) {
  const { supabase, user } = await requireUserSession()
  if (!user) return apiError('Unauthorized', 401)

  const body = (await req.json().catch(() => null)) as { id?: string } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) return apiError('Missing id', 400)

  const { error } = await supabase
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return apiError(error.message || 'Update failed', 500)

  return apiResponse({ success: true })
}
