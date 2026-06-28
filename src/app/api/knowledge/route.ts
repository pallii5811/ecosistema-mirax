import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createKnowledgeObject } from '@/lib/knowledge-service'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const envId = req.nextUrl.searchParams.get('environment_id')
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))

  let query = supabase
    .from('knowledge_objects')
    .select('id, user_id, environment_id, object_type, title, body, payload, source, confidence, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (envId) query = query.eq('environment_id', envId)

  const { data, error } = await query
  if (error) {
    if (/relation .* does not exist|knowledge_objects/i.test(error.message)) {
      return NextResponse.json({ items: [], enabled: false })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [], enabled: true })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  try {
    const item = await createKnowledgeObject(supabase, user.id, body)
    return NextResponse.json({ item })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Errore creazione'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
