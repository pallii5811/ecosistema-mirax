import { createClient } from '@/utils/supabase/server'

// PATCH /api/lists/:id — rename a list / update its description (leads untouched).
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
    | { name?: string; description?: string | null }
    | null

  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return Response.json({ error: 'Il nome della lista non può essere vuoto' }, { status: 400 })
    }
    patch.name = name
  }
  if (typeof body?.description !== 'undefined') {
    const desc = typeof body.description === 'string' ? body.description.trim() : ''
    patch.description = desc || null
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Nessuna modifica fornita' }, { status: 400 })
  }

  const { data: updated, error: updErr } = await supabase
    .from('lists')
    .update(patch)
    .eq('id', listId)
    .eq('user_id', user.id)
    .select('id, name, description')
    .maybeSingle()

  if (updErr) {
    return Response.json({ error: updErr.message }, { status: 500 })
  }
  if (!updated) {
    return Response.json({ error: 'List not found' }, { status: 404 })
  }

  return Response.json({ ok: true, list: updated })
}

// DELETE /api/lists/:id — removes the list from the user's account (leads are kept).

export async function DELETE(
  _req: Request,
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

  const { data: listRow, error: listErr } = await supabase
    .from('lists')
    .select('id')
    .eq('id', listId)
    .eq('user_id', user.id)
    .single()

  if (listErr || !listRow) {
    return Response.json({ error: 'List not found' }, { status: 404 })
  }

  const { error: linksErr } = await supabase.from('list_leads').delete().eq('list_id', listId)
  if (linksErr) {
    return Response.json({ error: linksErr.message }, { status: 500 })
  }

  const { error: deleteErr } = await supabase
    .from('lists')
    .delete()
    .eq('id', listId)
    .eq('user_id', user.id)

  if (deleteErr) {
    return Response.json({ error: deleteErr.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
