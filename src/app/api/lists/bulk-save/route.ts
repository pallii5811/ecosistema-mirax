import { createClient } from '@/utils/supabase/server'

// POST /api/lists/bulk-save
// Body:
// {
//   name: string,                 // new list name (required)
//   description?: string,
//   environmentId?: string,       // attach to existing env (optional)
//   environmentName?: string,     // OR create a new env with this name (optional)
//   leads: Array<{                // the whole search results
//     name?, website?, email?, phone?, city?, category?, score?, raw?
//   }>
// }
//
// Response: { ok, listId, environmentId?, listLink, leadsInserted }

type Lead = {
  name?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  city?: string | null
  category?: string | null
  score?: number | null
  raw?: unknown
}

type Body = {
  name?: string
  description?: string
  environmentId?: string
  environmentName?: string
  mergeIntoListId?: string
  leads?: Lead[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INSERT_CHUNK_SIZE = 25

function normalizeListName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function pickString(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function websiteKey(website: string | null | undefined): string | null {
  if (typeof website !== 'string') return null
  const trimmed = website.trim()
  if (!trimmed) return null
  return trimmed.toLowerCase().replace(/\/+$/, '')
}

function isDuplicateWebsiteError(message: string | undefined): boolean {
  if (!message) return false
  return /duplicate key|leads_website_unique|23505/i.test(message)
}

// Normalizes a raw search result item into the columns of the `leads` table.
function normalizeLead(raw: any): Lead {
  return {
    name: pickString(raw, ['name', 'nome', 'azienda', 'company']),
    website: pickString(raw, ['website', 'sito', 'url']),
    email: pickString(raw, ['email', 'mail']),
    phone: pickString(raw, ['phone', 'telefono']),
    city: pickString(raw, ['city', 'citta']),
    category: pickString(raw, ['category', 'categoria']),
    score: pickNumber(raw, ['score', 'opportunity_score']),
    raw,
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

  const userId = user.id

  const body = (await req.json().catch(() => null)) as Body | null
  const name = body?.name?.trim()
  if (!name) {
    return Response.json({ error: 'Missing list name' }, { status: 400 })
  }

  const rawLeads = Array.isArray(body?.leads) ? body!.leads! : []
  if (rawLeads.length === 0) {
    return Response.json({ error: 'Nessun lead da salvare' }, { status: 400 })
  }

  // --- Step 1: resolve environment (if any) ------------------------------
  let environmentId: string | null = null

  if (body?.environmentId && UUID_RE.test(body.environmentId)) {
    // Verify it belongs to the user.
    const { data: envRow } = await supabase
      .from('environments')
      .select('id')
      .eq('id', body.environmentId)
      .eq('user_id', userId)
      .maybeSingle()
    if (envRow) environmentId = envRow.id
  } else if (body?.environmentName?.trim()) {
    const envName = body.environmentName.trim()
    const { data: envRow, error: envErr } = await supabase
      .from('environments')
      .insert({
        user_id: userId,
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
    environmentId = envRow.id
  }

  // --- Step 2: create or reuse the list ----------------------------------
  let listId: string | null = null
  let merged = false

  if (body?.mergeIntoListId && UUID_RE.test(body.mergeIntoListId)) {
    const { data: mergeRow } = await supabase
      .from('lists')
      .select('id')
      .eq('id', body.mergeIntoListId)
      .eq('user_id', userId)
      .maybeSingle()
    if (mergeRow?.id) {
      listId = mergeRow.id
      merged = true
    }
  }

  if (!listId) {
    const { data: userLists } = await supabase.from('lists').select('id, name').eq('user_id', userId)
    const wantedName = normalizeListName(name)
    const existingByName = (userLists ?? []).find((row) => normalizeListName(String(row.name || '')) === wantedName)
    if (existingByName?.id) {
      listId = existingByName.id
      merged = true
    }
  }

  if (!listId) {
    // Create a new list. environment_id column is optional (migration may not be applied yet) — try with, fall back without.
    const listInsert: Record<string, unknown> = {
      user_id: userId,
      name,
      description: body?.description?.trim() || null,
    }
    if (environmentId) listInsert.environment_id = environmentId

    const { data: listRow, error: listErr } = await supabase
      .from('lists')
      .insert(listInsert)
      .select('id')
      .single()

    if (listErr) {
      // Fallback: column environment_id may not exist yet — retry without it.
      if (environmentId && /environment_id/i.test(listErr.message || '')) {
        const { data: retryRow, error: retryErr } = await supabase
          .from('lists')
          .insert({
            user_id: userId,
            name,
            description: body?.description?.trim() || null,
          })
          .select('id')
          .single()
        if (retryErr || !retryRow) {
          return Response.json({ error: retryErr?.message || 'Errore creazione lista' }, { status: 500 })
        }
        listId = retryRow.id
      } else {
        return Response.json({ error: listErr.message }, { status: 500 })
      }
    } else {
      listId = listRow!.id
    }
  } else if (body?.description?.trim() || environmentId) {
    // Existing list (merge): best-effort update of description / environment link.
    const patch: Record<string, unknown> = {}
    if (body?.description?.trim()) patch.description = body.description.trim()
    if (environmentId) patch.environment_id = environmentId
    if (Object.keys(patch).length > 0) {
      const { error: patchErr } = await supabase.from('lists').update(patch).eq('id', listId).eq('user_id', userId)
      // Fallback: environment_id column may not exist yet — retry with description only.
      if (patchErr && /environment_id/i.test(patchErr.message || '') && body?.description?.trim()) {
        await supabase.from('lists').update({ description: body.description.trim() }).eq('id', listId).eq('user_id', userId)
      }
    }
  }

  if (!listId) {
    return Response.json({ error: 'Errore creazione lista' }, { status: 500 })
  }

  // --- Step 3: save leads on this user's account -------------------------
  type LeadRow = {
    user_id: string
    name: string | null
    website: string | null
    email: string | null
    phone: string | null
    city: string | null
    category: string | null
    score: number | null
    raw: unknown
  }

  const allNormalized: LeadRow[] = rawLeads.map(normalizeLead).map((l) => ({
    user_id: userId,
    name: l.name ?? null,
    website: l.website ?? null,
    email: l.email ?? null,
    phone: l.phone ?? null,
    city: l.city ?? null,
    category: l.category ?? null,
    score: typeof l.score === 'number' ? l.score : null,
    raw: l.raw ?? null,
  }))

  // Deduplicate by website within the batch (same URL twice → one entry).
  const seenWebsites = new Set<string>()
  const normalized = allNormalized.filter((l) => {
    const key = websiteKey(l.website)
    if (!key) return true
    if (seenWebsites.has(key)) return false
    seenWebsites.add(key)
    return true
  })

  const existingByWebsite = new Map<string, string>()
  const { data: existingRows, error: existingErr } = await supabase
    .from('leads')
    .select('id, website')
    .eq('user_id', userId)

  if (existingErr) {
    return Response.json({ error: existingErr.message, listId, leadsInserted: 0 }, { status: 500 })
  }

  for (const row of existingRows ?? []) {
    const key = websiteKey(row.website)
    if (key) existingByWebsite.set(key, row.id)
  }

  const toInsertWithWebsite = normalized.filter((l) => {
    const key = websiteKey(l.website)
    return !!key && !existingByWebsite.has(key)
  })
  const noWebsiteLeads = normalized.filter((l) => !websiteKey(l.website))

  function rememberLeadId(website: string | null, id: string) {
    const key = websiteKey(website)
    if (key) existingByWebsite.set(key, id)
  }

  async function resolveExistingLeadId(website: string): Promise<string | null> {
    const wanted = websiteKey(website)
    if (wanted) {
      const cached = existingByWebsite.get(wanted)
      if (cached) return cached
    }

    const { data: exactRow } = await supabase
      .from('leads')
      .select('id, website, user_id')
      .eq('website', website)
      .maybeSingle()

    if (exactRow?.id && exactRow.user_id === userId) {
      rememberLeadId(exactRow.website, exactRow.id)
      return exactRow.id
    }

    return null
  }

  let skippedDuplicates = 0
  for (let i = 0; i < toInsertWithWebsite.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsertWithWebsite.slice(i, i + INSERT_CHUNK_SIZE)
    const { data: insertedChunk, error: leadsErr } = await supabase
      .from('leads')
      .insert(chunk)
      .select('id, website')

    if (!leadsErr && insertedChunk) {
      for (const row of insertedChunk) {
        rememberLeadId(row.website, row.id)
      }
      continue
    }

    // Chunk fallito: fallback solo sui lead di questo chunk.
    for (const lead of chunk) {
      const { data: inserted, error: insertErr } = await supabase
        .from('leads')
        .insert(lead)
        .select('id, website')
        .single()

      if (!insertErr && inserted?.id) {
        rememberLeadId(inserted.website, inserted.id)
        continue
      }

      if (lead.website && isDuplicateWebsiteError(insertErr?.message || leadsErr?.message)) {
        const reusedId = await resolveExistingLeadId(lead.website)
        if (reusedId) continue
        skippedDuplicates += 1
        continue
      }

      return Response.json(
        {
          error: insertErr?.message || leadsErr?.message || 'Errore salvataggio lead',
          listId,
          leadsInserted: 0,
        },
        { status: 500 }
      )
    }
  }

  const noWebsiteIds: string[] = []
  for (let i = 0; i < noWebsiteLeads.length; i += INSERT_CHUNK_SIZE) {
    const chunk = noWebsiteLeads.slice(i, i + INSERT_CHUNK_SIZE)
    const { data: insertedChunk, error: leadsErr } = await supabase
      .from('leads')
      .insert(chunk)
      .select('id')

    if (leadsErr || !insertedChunk) {
      return Response.json(
        {
          error: leadsErr?.message || 'Errore salvataggio lead',
          listId,
          leadsInserted: 0,
        },
        { status: 500 }
      )
    }

    noWebsiteIds.push(...insertedChunk.map((r) => r.id))
  }

  const savedLeadIds: string[] = []
  let noWebsiteIdx = 0
  for (const lead of normalized) {
    const key = websiteKey(lead.website)
    if (key) {
      const id = existingByWebsite.get(key)
      if (id) savedLeadIds.push(id)
    } else {
      const id = noWebsiteIds[noWebsiteIdx++]
      if (id) savedLeadIds.push(id)
    }
  }

  if (savedLeadIds.length === 0) {
    return Response.json({ error: 'Nessun lead salvato', listId, leadsInserted: 0 }, { status: 500 })
  }

  // --- Step 4: link leads to the list ------------------------------------
  const { data: existingLinks } = await supabase.from('list_leads').select('lead_id').eq('list_id', listId)
  const alreadyLinked = new Set((existingLinks ?? []).map((row) => row.lead_id as string))
  const newLeadIds = savedLeadIds.filter((leadId) => !alreadyLinked.has(leadId))

  const linkRows = newLeadIds.map((leadId) => ({ list_id: listId, lead_id: leadId }))
  for (let i = 0; i < linkRows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = linkRows.slice(i, i + INSERT_CHUNK_SIZE)
    const { error: linkErr } = await supabase.from('list_leads').insert(chunk)
    if (linkErr) {
      return Response.json(
        {
          error: linkErr.message,
          listId,
          leadsInserted: savedLeadIds.length,
        },
        { status: 500 }
      )
    }
  }

  return Response.json({
    ok: true,
    listId,
    environmentId,
    leadsInserted: savedLeadIds.length,
    leadsAdded: newLeadIds.length,
    merged,
    skippedDuplicates,
  })
}
