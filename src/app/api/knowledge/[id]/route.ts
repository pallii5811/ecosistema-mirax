import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  buildKnowledgeDocument,
  clampConfidence,
  sanitizeKnowledgeType,
} from '@/lib/knowledge-object'
import { embeddingToPgVector, liteTextEmbedding } from '@/lib/knowledge-embeddings'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('knowledge_objects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ item: data })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.title === 'string') updates.title = body.title.trim().slice(0, 300)
  if ('body' in body) updates.body = body.body ? String(body.body).slice(0, 8000) : null
  if ('object_type' in body) updates.object_type = sanitizeKnowledgeType(body.object_type)
  if ('confidence' in body) updates.confidence = clampConfidence(body.confidence)
  if ('payload' in body && body.payload && typeof body.payload === 'object') updates.payload = body.payload

  if (typeof updates.title === 'string' || 'body' in updates) {
    const { data: prev } = await supabase
      .from('knowledge_objects')
      .select('title, body')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    const title = String(updates.title ?? prev?.title ?? '')
    const textBody = (updates.body as string | null) ?? prev?.body ?? null
    updates.embedding = embeddingToPgVector(liteTextEmbedding(buildKnowledgeDocument(title, textBody)))
  }

  const { data, error } = await supabase
    .from('knowledge_objects')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('knowledge_objects').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
