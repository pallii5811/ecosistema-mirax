import { createClient } from '@/utils/supabase/server'

// PATCH /api/lists/:id/environment
// Attach an existing list to an environment (either existing via environmentId or a new one via environmentName).
// Body: { environmentId?: string } | { environmentName?: string } | { environmentId: null } (to detach)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id: listId } = await params

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    | { environmentId?: string | null; environmentName?: string }
    | null

  // Verify list belongs to user.
  const { data: listRow, error: listErr } = await supabase
    .from('lists')
    .select('id')
    .eq('id', listId)
    .eq('user_id', user.id)
    .single()

  if (listErr || !listRow) {
    return Response.json({ error: 'List not found' }, { status: 404 })
  }

  // Resolve target environment.
  let targetEnvId: string | null = null

  if (body?.environmentId === null) {
    // Detach.
    targetEnvId = null
  } else if (body?.environmentId && UUID_RE.test(body.environmentId)) {
    const { data: envRow } = await supabase
      .from('environments')
      .select('id')
      .eq('id', body.environmentId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!envRow) {
      return Response.json({ error: 'Environment not found' }, { status: 404 })
    }
    targetEnvId = envRow.id
  } else if (body?.environmentName?.trim()) {
    const envName = body.environmentName.trim()
    const { data: envRow, error: envErr } = await supabase
      .from('environments')
      .insert({
        user_id: user.id,
        name: envName,
        description: null,
        icon: 'folder',
        color: '#8B5CF6',
        lead_ids: [],
        search_ids: [],
        filters: {},
        stats: {},
        is_auto_update: false,
      })
      .select('id')
      .single()
    if (envErr || !envRow) {
      return Response.json({ error: envErr?.message || 'Errore creazione ambiente' }, { status: 500 })
    }
    targetEnvId = envRow.id
  } else {
    return Response.json({ error: 'Missing environmentId or environmentName' }, { status: 400 })
  }

  const { error: updErr } = await supabase
    .from('lists')
    .update({ environment_id: targetEnvId })
    .eq('id', listId)
    .eq('user_id', user.id)

  if (updErr) {
    // Fallback: column may not exist yet — let client know migration is needed.
    if (/environment_id/i.test(updErr.message || '')) {
      return Response.json(
        {
          error:
            'La colonna environment_id non esiste ancora. Esegui la migrazione SQL in db/migrations/2026_04_24_lists_environment_link.sql',
        },
        { status: 500 }
      )
    }
    return Response.json({ error: updErr.message }, { status: 500 })
  }

  return Response.json({ ok: true, environmentId: targetEnvId })
}
