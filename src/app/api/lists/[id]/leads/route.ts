import { createClient } from '@/utils/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id } = await params

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify list belongs to user
  const { data: listRow, error: listError } = await supabase
    .from('lists')
    .select('id, name')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (listError || !listRow) {
    return Response.json({ error: 'List not found' }, { status: 404 })
  }

  // Fetch leads via join table
  const { data: rows, error: leadsError } = await supabase
    .from('list_leads')
    .select('leads!inner(id, name, website, email, phone, city, category, score, raw, created_at)')
    .eq('list_id', id)

  if (leadsError) {
    return Response.json({ error: leadsError.message }, { status: 500 })
  }

  const leads = (rows ?? []).map((r: any) => r.leads).filter(Boolean)

  return Response.json({ listName: listRow.name, leads })
}
