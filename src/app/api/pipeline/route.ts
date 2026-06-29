import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sanitizePipelineStage, PIPELINE_STAGES } from '@/lib/pipeline-stages'
import { recordPipelineStageFeedback } from '@/lib/scoring-feedback'
import { getEntityByAlias, getEntityByCanonicalId, upsertEntity, normalizeDomain, slugifyName } from '@/lib/universe'

function sanitizeScore(s: unknown): number {
  const n = typeof s === 'number' ? s : Number(s)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function sanitizeDealValue(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

function sanitizeText(t: unknown, max = 500): string | null {
  if (typeof t !== 'string') return null
  const trimmed = t.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data, error } = await supabase
    .from('lead_pipeline')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data || [], stages: PIPELINE_STAGES })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { lead_name, lead_website, lead_phone, lead_email, lead_city, lead_category, lead_score, stage, deal_value, notes } = body || {}

  const cleanName = sanitizeText(lead_name, 200)
  if (!cleanName) return NextResponse.json({ error: 'Nome lead obbligatorio' }, { status: 400 })

  const { data, error } = await supabase
    .from('lead_pipeline')
    .insert({
      user_id: user.id,
      lead_name: cleanName,
      lead_website: sanitizeText(lead_website, 500),
      lead_phone: sanitizeText(lead_phone, 50),
      lead_email: sanitizeText(lead_email, 200),
      lead_city: sanitizeText(lead_city, 100),
      lead_category: sanitizeText(lead_category, 100),
      lead_score: sanitizeScore(lead_score),
      stage: sanitizePipelineStage(stage),
      deal_value: sanitizeDealValue(deal_value),
      notes: sanitizeText(notes, 5000),
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Universe sidecar: ensure entity exists and link user context
  if (process.env.UNIVERSE_ENABLED === '1') {
    Promise.resolve().then(async () => {
      try {
        const admin = await import('@/utils/supabase/server').then((m) => m.createServiceRoleClient())
        let entityId: string | null = null
        const domain = normalizeDomain(lead_website)
        if (domain) {
          const byAlias = await getEntityByAlias(admin, 'domain', domain, 'company')
          if (byAlias) entityId = byAlias.id
        }
        if (!entityId && domain) {
          const byCanonical = await getEntityByCanonicalId(admin, domain, 'company')
          if (byCanonical) entityId = byCanonical.id
        }
        if (!entityId && cleanName) {
          const canonical = domain ?? slugifyName(cleanName)
          if (canonical) {
            const { entity } = await upsertEntity(admin, {
              canonical_id: canonical,
              entity_type: 'company',
              name: cleanName,
              slug: slugifyName(cleanName),
              city: sanitizeText(lead_city, 100),
              metadata: { category: sanitizeText(lead_category, 100) },
              confidence: 0.8,
              aliases: domain ? [{ alias_type: 'domain', alias_value: domain, confidence: 0.9 }] : undefined,
            })
            entityId = entity.id
          }
        }
        if (entityId) {
          await admin.from('universe_user_context').upsert(
            {
              user_id: user.id,
              entity_id: entityId,
              context_type: 'pipeline',
              metadata: { pipeline_id: data.id, stage: sanitizePipelineStage(stage) },
            },
            { onConflict: 'user_id, entity_id, context_type' }
          )
        }
      } catch (e) {
        console.warn('[pipeline] Universe sidecar failed:', e)
      }
    }).catch(() => {})
  }

  return NextResponse.json({ item: data })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { id, ...updates } = body || {}

  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'ID obbligatorio' }, { status: 400 })

  const { data: prev } = await supabase
    .from('lead_pipeline')
    .select('stage, lead_website, lead_name, lead_score')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const safeUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ('lead_name' in updates) {
    const v = sanitizeText(updates.lead_name, 200)
    if (!v) return NextResponse.json({ error: 'Nome lead obbligatorio' }, { status: 400 })
    safeUpdates.lead_name = v
  }
  if ('lead_website' in updates) safeUpdates.lead_website = sanitizeText(updates.lead_website, 500)
  if ('lead_phone' in updates) safeUpdates.lead_phone = sanitizeText(updates.lead_phone, 50)
  if ('lead_email' in updates) safeUpdates.lead_email = sanitizeText(updates.lead_email, 200)
  if ('lead_city' in updates) safeUpdates.lead_city = sanitizeText(updates.lead_city, 100)
  if ('lead_category' in updates) safeUpdates.lead_category = sanitizeText(updates.lead_category, 100)
  if ('lead_score' in updates) safeUpdates.lead_score = sanitizeScore(updates.lead_score)
  if ('stage' in updates) safeUpdates.stage = sanitizePipelineStage(updates.stage)
  if ('deal_value' in updates) safeUpdates.deal_value = sanitizeDealValue(updates.deal_value)
  if ('notes' in updates) safeUpdates.notes = sanitizeText(updates.notes, 5000)
  if ('next_action' in updates) safeUpdates.next_action = sanitizeText(updates.next_action, 500)
  if ('next_action_date' in updates) {
    const v = updates.next_action_date
    safeUpdates.next_action_date = v && typeof v === 'string' ? v : null
  }

  const { data, error } = await supabase
    .from('lead_pipeline')
    .update(safeUpdates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const newStage = typeof safeUpdates.stage === 'string' ? safeUpdates.stage : prev?.stage
  if (prev && newStage && prev.stage !== newStage && (newStage === 'vinto' || newStage === 'perso')) {
    try {
      await recordPipelineStageFeedback(supabase, user.id, {
        website: prev.lead_website,
        name: prev.lead_name,
        stage: newStage,
        scoreAtTime: Number(prev.lead_score) || null,
      })
    } catch {
      /* non-blocking */
    }
  }

  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID obbligatorio' }, { status: 400 })

  const { error } = await supabase
    .from('lead_pipeline')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
