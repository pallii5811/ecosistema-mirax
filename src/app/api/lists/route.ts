import { createClient } from '@/utils/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data, error } = await supabase
      .from('lists')
      .select('id, name, description, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.log('[lists] query error (table may not exist):', error.message)
      return Response.json({ lists: [] })
    }

    return Response.json({ lists: data ?? [] })
  } catch {
    return Response.json({ lists: [] })
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { name?: string; description?: string } | null

  const name = body?.name?.trim()
  const description = body?.description?.trim() ?? null

  if (!name) {
    return Response.json({ error: 'Missing name' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('lists')
    .insert({ user_id: user.id, name, description })
    .select('id, name, description, created_at')
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ list: data })
}
