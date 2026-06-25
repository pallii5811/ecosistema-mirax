import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET  /api/sequences         → lista sequenze utente
 * POST /api/sequences         → crea/aggiorna sequenza
 *
 * SCHEMA RICHIESTO (da applicare una volta in Supabase SQL editor):
 *
 *   CREATE TABLE IF NOT EXISTS sequences (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     name TEXT NOT NULL,
 *     company_name TEXT,
 *     website TEXT,
 *     service TEXT,
 *     sender_name TEXT,
 *     sender_company TEXT,
 *     tone TEXT,
 *     steps JSONB NOT NULL DEFAULT '[]'::jsonb,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_sequences_user_id ON sequences(user_id, updated_at DESC);
 *   ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "users own sequences" ON sequences
 *     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
 *
 * Se la tabella non esiste, l'API restituisce array vuoto (graceful degradation).
 */

type StepIn = { step?: number; subject?: unknown; body?: unknown; waitDays?: unknown }

function sanitizeText(t: unknown, max = 500): string | null {
  if (typeof t !== 'string') return null
  const trimmed = t.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function sanitizeSteps(input: unknown): Array<{ step: number; subject: string; body: string; waitDays: number }> {
  if (!Array.isArray(input)) return []
  return input.slice(0, 20).map((s: StepIn, i) => ({
    step: typeof s?.step === 'number' && Number.isFinite(s.step) ? Math.max(1, Math.round(s.step)) : i + 1,
    subject: typeof s?.subject === 'string' ? s.subject.slice(0, 300) : '',
    body: typeof s?.body === 'string' ? s.body.slice(0, 5000) : '',
    waitDays: typeof s?.waitDays === 'number' && Number.isFinite(s.waitDays) ? Math.max(0, Math.min(365, Math.round(s.waitDays))) : i * 3,
  }))
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ sequences: [], error: 'Unauthorized' }, { status: 401 })

  try {
    const { data, error } = await supabase
      .from('sequences')
      .select('id, name, company_name, website, service, sender_name, sender_company, tone, steps, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(100)

    if (error) {
      // Tabella mancante → graceful empty
      return NextResponse.json({ sequences: [], tableMissing: true })
    }
    return NextResponse.json({ sequences: data ?? [] })
  } catch {
    return NextResponse.json({ sequences: [], tableMissing: true })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Body non valido' }, { status: 400 })
  }

  const id = typeof (body as any).id === 'string' ? (body as any).id : null
  const name = sanitizeText((body as any).name, 200)
  if (!name) return NextResponse.json({ ok: false, error: 'Nome obbligatorio' }, { status: 400 })

  const payload: Record<string, unknown> = {
    name,
    company_name: sanitizeText((body as any).companyName ?? (body as any).company_name, 200),
    website: sanitizeText((body as any).website, 500),
    service: sanitizeText((body as any).service, 200),
    sender_name: sanitizeText((body as any).senderName ?? (body as any).sender_name, 200),
    sender_company: sanitizeText((body as any).senderCompany ?? (body as any).sender_company, 200),
    tone: sanitizeText((body as any).tone, 50) ?? 'professionale',
    steps: sanitizeSteps((body as any).steps ?? (body as any).sequence),
    updated_at: new Date().toISOString(),
  }

  try {
    if (id) {
      const { data, error } = await supabase
        .from('sequences')
        .update(payload)
        .eq('id', id)
        .eq('user_id', user.id)
        .select('*')
        .single()

      if (error) {
        if (/relation .* does not exist/i.test(error.message)) {
          return NextResponse.json({ ok: false, tableMissing: true, error: 'Tabella sequences non configurata' }, { status: 503 })
        }
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, sequence: data })
    }

    const insertPayload = { ...payload, user_id: user.id }
    const { data, error } = await supabase
      .from('sequences')
      .insert(insertPayload)
      .select('*')
      .single()

    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json({ ok: false, tableMissing: true, error: 'Tabella sequences non configurata' }, { status: 503 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, sequence: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Errore interno' }, { status: 500 })
  }
}
