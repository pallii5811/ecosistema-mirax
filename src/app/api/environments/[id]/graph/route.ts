import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildEnvironmentGraph } from '@/lib/environment-graph'
import type { EnvironmentStats } from '@/types/environments'

type Ctx = { params: Promise<{ id: string }> }

function emptyStats(): EnvironmentStats {
  return {
    total_leads: 0,
    avg_score: 0,
    leads_with_email: 0,
    leads_with_phone: 0,
    leads_no_pixel: 0,
    leads_no_gtm: 0,
    top_categories: [],
    top_cities: [],
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: environment, error: envErr } = await supabase
    .from('environments')
    .select('id, name, color, stats')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (envErr) return NextResponse.json({ error: envErr.message }, { status: 500 })
  if (!environment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: linkedLists } = await supabase
    .from('lists')
    .select('id, name, description, created_at')
    .eq('user_id', user.id)
    .eq('environment_id', id)
    .order('created_at', { ascending: false })

  const listIds = (linkedLists ?? []).map((l) => l.id)
  const countByList = new Map<string, number>()

  if (listIds.length > 0) {
    const { data: linkRows } = await supabase.from('list_leads').select('list_id').in('list_id', listIds)
    for (const row of linkRows ?? []) {
      const lid = String((row as any).list_id ?? '')
      if (lid) countByList.set(lid, (countByList.get(lid) ?? 0) + 1)
    }
  }

  const lists = (linkedLists ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description ?? null,
    created_at: l.created_at,
    leadsCount: countByList.get(l.id) ?? 0,
  }))

  const stats =
    environment.stats && typeof environment.stats === 'object'
      ? { ...emptyStats(), ...(environment.stats as EnvironmentStats) }
      : emptyStats()

  const totalLeads = Math.max(
    stats.total_leads,
    lists.reduce((s, l) => s + l.leadsCount, 0),
  )

  const { data: knowledge } = await supabase
    .from('knowledge_objects')
    .select('id, title, object_type, confidence')
    .eq('user_id', user.id)
    .eq('environment_id', id)
    .order('confidence', { ascending: false })
    .limit(12)

  const graph = buildEnvironmentGraph({
    environmentId: id,
    envName: environment.name,
    envColor: environment.color || '#8B5CF6',
    totalLeads,
    lists,
    stats,
    knowledge: (knowledge ?? []).map((k) => ({
      id: k.id as string,
      title: String(k.title ?? ''),
      object_type: String(k.object_type ?? 'insight'),
      confidence: Number(k.confidence) || 0.5,
    })),
  })

  return NextResponse.json({
    environment: { id: environment.id, name: environment.name, color: environment.color },
    stats,
    lists,
    knowledge: knowledge ?? [],
    graph,
  })
}
