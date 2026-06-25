'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type {
  CreateEnvironmentInput,
  Environment,
  EnvironmentListSummary,
  EnvironmentStats,
  UpdateEnvironmentInput,
} from '@/types/environments'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sanitizeUuidArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => UUID_RE.test(v))
}

export async function getEnvironments(): Promise<Environment[]> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data, error } = await supabase
    .from('environments')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('Error fetching environments:', error)
    return []
  }

  return (data || []) as Environment[]
}

export type { EnvironmentListSummary } from '@/types/environments'

function formatLeadFromDbRow(lead: any) {
  const raw = lead?.raw && typeof lead.raw === 'object' ? lead.raw : {}
  return {
    ...raw,
    id: lead.id,
    nome: lead.name ?? (raw as any).nome ?? (raw as any).azienda ?? '',
    sito: lead.website ?? (raw as any).sito ?? (raw as any).website ?? '',
    email: lead.email ?? (raw as any).email ?? '',
    telefono: lead.phone ?? (raw as any).telefono ?? (raw as any).phone ?? '',
    citta: lead.city ?? (raw as any).citta ?? (raw as any).city ?? '',
    categoria: lead.category ?? (raw as any).categoria ?? (raw as any).category ?? '',
    score: typeof lead.score === 'number' ? lead.score : (raw as any).score ?? null,
    meta_pixel: (raw as any).meta_pixel ?? null,
    has_pixel: (raw as any).has_pixel ?? null,
    google_tag_manager: (raw as any).google_tag_manager ?? null,
    has_gtm: (raw as any).has_gtm ?? null,
  }
}

function dedupeLeads(leads: any[]): any[] {
  const seen = new Set<string>()
  const out: any[] = []
  for (const lead of leads) {
    const site = String(lead?.sito || lead?.website || '').trim().toLowerCase()
    const name = String(lead?.nome || lead?.name || lead?.azienda || '').trim().toLowerCase()
    const key = site || name || JSON.stringify(lead)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(lead)
  }
  return out
}

export async function getEnvironmentWithLeads(
  environmentId: string
): Promise<{ environment: Environment | null; leads: any[]; lists: EnvironmentListSummary[] }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { environment: null, leads: [], lists: [] }

  const { data: environment, error } = await supabase
    .from('environments')
    .select('*')
    .eq('id', environmentId)
    .eq('user_id', user.id)
    .single()

  if (error || !environment) {
    console.error('Error fetching environment:', error)
    return { environment: null, leads: [], lists: [] }
  }

  let leads: any[] = []
  let lists: EnvironmentListSummary[] = []

  // Primary path: lists explicitly linked to this environment.
  const { data: linkedLists, error: listsErr } = await supabase
    .from('lists')
    .select('id, name, description, created_at')
    .eq('user_id', user.id)
    .eq('environment_id', environmentId)
    .order('created_at', { ascending: false })

  if (listsErr && !/environment_id/i.test(listsErr.message || '')) {
    console.error('Error fetching environment lists:', listsErr)
  }

  if (linkedLists && linkedLists.length > 0) {
    const listIds = linkedLists.map((l) => l.id)
    const { data: linkRows, error: linkErr } = await supabase
      .from('list_leads')
      .select('list_id, lead_id, leads(*)')
      .in('list_id', listIds)

    if (linkErr) {
      console.error('Error fetching list leads for environment:', linkErr)
    }

    const countByList = new Map<string, number>()
    const leadsById = new Map<string, any>()

    for (const row of linkRows ?? []) {
      const listId = (row as any).list_id as string
      countByList.set(listId, (countByList.get(listId) ?? 0) + 1)
      const leadRow = (row as any).leads
      if (leadRow?.id) leadsById.set(leadRow.id, formatLeadFromDbRow(leadRow))
    }

    lists = linkedLists.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description ?? null,
      created_at: l.created_at,
      leadsCount: countByList.get(l.id) ?? 0,
    }))

    leads = dedupeLeads(Array.from(leadsById.values()))
  }

  const envSearchIds = sanitizeUuidArray((environment as any).search_ids)

  if (envSearchIds.length > 0) {
    const { data: searches, error: sErr } = await supabase
      .from('searches')
      .select('id, results')
      .in('id', envSearchIds)
      .eq('status', 'completed')

    if (sErr) {
      console.error('Error fetching searches for environment:', sErr)
    }

    if (searches && searches.length > 0) {
      const allLeads: any[] = []

      for (const s of searches as any[]) {
        const r = (s as any)?.results
        if (!r) continue
        if (typeof r === 'string') {
          try {
            const parsed = JSON.parse(r)
            if (Array.isArray(parsed)) allLeads.push(...parsed)
            else if (parsed && Array.isArray((parsed as any).results)) allLeads.push(...(parsed as any).results)
          } catch {
            // ignore
          }
          continue
        }
        if (Array.isArray(r)) {
          allLeads.push(...r)
          continue
        }
        if (r && Array.isArray((r as any).results)) {
          allLeads.push(...(r as any).results)
        }
      }

      leads = dedupeLeads([...leads, ...allLeads])
    }
  }

  return { environment: environment as Environment, leads, lists }
}

export async function createEnvironment(input: CreateEnvironmentInput): Promise<{
  success: boolean
  environment?: Environment
  error?: string
}> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, error: 'Non autenticato' }

  const { data, error } = await supabase
    .from('environments')
    .insert({
      user_id: user.id,
      name: input.name,
      description: input.description || null,
      icon: input.icon || 'folder',
      color: input.color || '#8B5CF6',
      lead_ids: sanitizeUuidArray(input.lead_ids),
      search_ids: sanitizeUuidArray(input.search_ids),
      filters: input.filters || {},
      stats: {},
      is_auto_update: false,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating environment:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/environments')
  return { success: true, environment: data as Environment }
}

export async function updateEnvironment(input: UpdateEnvironmentInput): Promise<{
  success: boolean
  environment?: Environment
  error?: string
}> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, error: 'Non autenticato' }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (typeof input.name === 'string') payload.name = input.name
  if (typeof input.description !== 'undefined') payload.description = input.description ?? null
  if (typeof input.icon === 'string') payload.icon = input.icon
  if (typeof input.color === 'string') payload.color = input.color
  if (typeof input.lead_ids !== 'undefined') payload.lead_ids = sanitizeUuidArray(input.lead_ids)
  if (typeof input.search_ids !== 'undefined') payload.search_ids = sanitizeUuidArray(input.search_ids)
  if (typeof input.filters !== 'undefined') payload.filters = input.filters ?? {}

  const { data, error } = await supabase
    .from('environments')
    .update(payload)
    .eq('id', input.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    console.error('Error updating environment:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/environments')
  revalidatePath(`/dashboard/environments/${input.id}`)
  return { success: true, environment: data as Environment }
}

export async function addSearchesToEnvironment(
  environmentId: string,
  searchIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, error: 'Non autenticato' }

  const { data: env, error: envErr } = await supabase
    .from('environments')
    .select('search_ids')
    .eq('id', environmentId)
    .eq('user_id', user.id)
    .single()

  if (envErr || !env) {
    return { success: false, error: 'Ambiente non trovato' }
  }

  const currentIds = sanitizeUuidArray((env as any).search_ids)
  const incoming = sanitizeUuidArray(searchIds)
  const newIds = Array.from(new Set([...currentIds, ...incoming]))

  const { error } = await supabase
    .from('environments')
    .update({
      search_ids: newIds,
      updated_at: new Date().toISOString(),
    })
    .eq('id', environmentId)
    .eq('user_id', user.id)

  if (error) {
    console.error('Error updating environment:', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/environments')
  revalidatePath(`/dashboard/environments/${environmentId}`)
  return { success: true }
}

export async function recalculateEnvironmentStats(environmentId: string): Promise<{
  success: boolean
  stats?: EnvironmentStats
  error?: string
}> {
  const { environment, leads } = await getEnvironmentWithLeads(environmentId)

  if (!environment) {
    return { success: false, error: 'Ambiente non trovato' }
  }

  const stats: EnvironmentStats = {
    total_leads: leads.length,
    avg_score:
      leads.length > 0
        ? Math.round(leads.reduce((sum, l) => sum + (Number(l?.score) || 0), 0) / leads.length)
        : 0,
    leads_with_email: leads.filter((l) => !!l?.email).length,
    leads_with_phone: leads.filter((l) => !!l?.telefono || !!l?.phone).length,
    leads_no_pixel: leads.filter((l) => !l?.meta_pixel && !l?.has_pixel).length,
    leads_no_gtm: leads.filter((l) => !l?.google_tag_manager && !l?.has_gtm).length,
    top_categories: calculateTopItems(leads, 'categoria'),
    top_cities: calculateTopItems(leads, 'citta'),
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('environments')
    .update({ stats, updated_at: new Date().toISOString() })
    .eq('id', environmentId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/dashboard/environments/${environmentId}`)
  return { success: true, stats }
}

function calculateTopItems(leads: any[], field: string): { name: string; count: number }[] {
  const counts: Record<string, number> = {}

  for (const lead of leads) {
    const value = String((lead as any)?.[field] ?? '').trim()
    if (!value) continue
    counts[value] = (counts[value] || 0) + 1
  }

  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

export async function deleteEnvironment(environmentId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, error: 'Non autenticato' }

  const { error } = await supabase
    .from('environments')
    .delete()
    .eq('id', environmentId)
    .eq('user_id', user.id)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/environments')
  return { success: true }
}
