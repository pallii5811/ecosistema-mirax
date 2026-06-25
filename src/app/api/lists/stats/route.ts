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

  const { data: listRows, error: listError } = await supabase
    .from('lists')
    .select('id, name, description, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (listError) {
    return Response.json({ error: listError.message }, { status: 500 })
  }

  const lists = listRows ?? []

  if (lists.length === 0) {
    return Response.json({ lists: [], totalLeads: 0 })
  }

  const { data: leadRows, error: leadError } = await supabase
    .from('list_leads')
    .select('list_id, leads!inner(score)')
    .in(
      'list_id',
      lists.map((l) => l.id)
    )

  if (leadError) {
    return Response.json({ error: leadError.message }, { status: 500 })
  }

  const byList = new Map<string, { count: number; scoreSum: number; scoreCount: number }>()
  for (const l of lists) byList.set(l.id, { count: 0, scoreSum: 0, scoreCount: 0 })

  for (const row of leadRows ?? []) {
    const listId = (row as any).list_id as string
    const score = (row as any).leads?.score
    const agg = byList.get(listId)
    if (!agg) continue

    agg.count += 1
    if (typeof score === 'number') {
      agg.scoreSum += score
      agg.scoreCount += 1
    }
  }

  const listsWithStats = lists.map((l) => {
    const agg = byList.get(l.id) ?? { count: 0, scoreSum: 0, scoreCount: 0 }
    const avgScore = agg.scoreCount > 0 ? Math.round(agg.scoreSum / agg.scoreCount) : 0

    return {
      ...l,
      leadsCount: agg.count,
      avgScore,
    }
  })

  const totalLeads = listsWithStats.reduce((acc, l) => acc + (l.leadsCount ?? 0), 0)

  return Response.json({ lists: listsWithStats, totalLeads })
}
