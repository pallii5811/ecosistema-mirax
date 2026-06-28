import { NextResponse } from 'next/server'
import { requireUserSession } from '@/lib/api-auth'
import { listAgents, PRESET_PIPELINES } from '@/lib/agents/orchestrator'
import { loadInsightsSnapshot } from '@/lib/insights-data'

/**
 * GET /api/ecosistema/status — panoramica hub ecosistema (solo dev stack).
 */
export async function GET() {
  const { supabase, user } = await requireUserSession()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const userId = user.id

  const [
    pipelineRes,
    monitorsRes,
    alertsRes,
    crmRes,
    apiKeysRes,
    envRes,
    knowledgeRes,
    outreachRes,
  ] = await Promise.all([
    supabase.from('lead_pipeline').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('lead_monitors').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('lead_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false),
    supabase
      .from('crm_integrations')
      .select('id, type, name, is_active, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true),
    supabase.from('environments').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('knowledge_objects').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('outreach_log').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  const pipelineCount = pipelineRes.count ?? 0
  let pki: { score: number; grade: string } | null = null
  let closurePatterns = 0

  if (pipelineCount > 0) {
    try {
      const snapshot = await loadInsightsSnapshot(supabase, userId)
      pki = { score: snapshot.pki.score, grade: snapshot.pki.grade }
      closurePatterns = snapshot.closurePatterns?.length ?? 0
    } catch {
      // ignore
    }
  }

  const nousAdapters = ['hubspot', 'salesforce', 'webhook', 'dynamics', 'vtiger']

  return NextResponse.json({
    counts: {
      pipeline: pipelineCount,
      monitors: monitorsRes.count ?? 0,
      alerts_unread: alertsRes.count ?? 0,
      api_keys: apiKeysRes.count ?? 0,
      environments: envRes.count ?? 0,
      knowledge_objects: knowledgeRes.count ?? 0,
      outreach_logs: outreachRes.count ?? 0,
    },
    pki,
    closure_patterns: closurePatterns,
    crm_integrations: crmRes.data ?? [],
    nous: {
      layer: 'NOUS',
      adapters: nousAdapters,
      connected: (crmRes.data ?? []).map((r) => r.type),
    },
    agents: listAgents(),
    presets: PRESET_PIPELINES,
    api_v1: {
      base: '/api/v1',
      endpoints: [
        { method: 'POST', path: '/api/v1/leads', desc: 'Inserisci lead' },
        { method: 'GET', path: '/api/v1/pipeline', desc: 'Leggi pipeline' },
        { method: 'GET', path: '/api/v1/outreach', desc: 'Log outreach' },
        { method: 'GET', path: '/api/v1/environments', desc: 'Ambienti' },
      ],
    },
  })
}
