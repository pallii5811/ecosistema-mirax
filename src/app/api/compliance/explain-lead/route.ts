import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildLeadExplainabilityPackage } from '@/lib/ai-act-audit'

/**
 * POST /api/compliance/explain-lead
 * Body: { lead: object } — pacchetto explainability AI Act per un lead.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { lead?: Record<string, unknown> } | null
  if (!body?.lead || typeof body.lead !== 'object') {
    return NextResponse.json({ error: 'lead richiesto' }, { status: 400 })
  }

  const pkg = buildLeadExplainabilityPackage(body.lead)

  try {
    await supabase.from('ai_audit_trail').insert({
      user_id: user.id,
      decision_type: 'score',
      entity_ref: pkg.entity_ref,
      rationale: pkg.score_motivation.factors
        .filter((f) => f.active)
        .map((f) => `${f.factor} (+${f.points})`)
        .join('; ')
        .slice(0, 600) || 'Score rule-based da segnali tecnici',
      inputs: { signals: pkg.technical_report.signals },
      outputs: {
        opportunity_score: pkg.score_motivation.opportunity_score,
        digital_maturity: pkg.score_motivation.digital_maturity,
      },
      model: null,
    })
  } catch {
    /* best-effort */
  }

  return NextResponse.json(pkg)
}
