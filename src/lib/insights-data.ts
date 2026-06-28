/**
 * Blocco 6 — aggregazione dati reali per PKI / stats / AI insights.
 */

import { analyzeClosurePatterns, type PipelineRow, type OutreachRow } from '@/lib/closure-patterns'
import { buildEnvironmentMesh, type LeadMeshInput } from '@/lib/environment-correlations'
import { computePKI, type PKIReport } from '@/lib/pki'
import type { SupabaseClient } from '@supabase/supabase-js'

export type OutreachMetrics = {
  contacted: number
  interested: number
  notInterested: number
  replied: number
  responseRate: number
  interestRate: number
}

export type PipelineMetrics = {
  total: number
  won: number
  lost: number
  active: number
  stagnant: number
  pipelineValue: number
  totalRevenue: number
  avgDealSize: number
  avgScore: number
  winRate: number
}

export type InsightsSnapshot = {
  pipeline: PipelineMetrics
  outreach: OutreachMetrics
  environments: { count: number; totalLeads: number }
  knowledge: { count: number }
  closurePatterns: ReturnType<typeof analyzeClosurePatterns>
  mesh: ReturnType<typeof buildEnvironmentMesh>
  pki: PKIReport
}

function outreachMetrics(rows: OutreachRow[]): OutreachMetrics {
  const sent = rows.filter((r) => ['sent', 'replied', 'interested', 'not_interested', 'no_answer'].includes(String(r.status ?? '')))
  const interested = rows.filter((r) => r.status === 'interested' || r.status === 'replied').length
  const notInterested = rows.filter((r) => r.status === 'not_interested').length
  const replied = rows.filter((r) => ['replied', 'interested', 'not_interested'].includes(String(r.status ?? ''))).length
  const contacted = sent.length
  const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0
  const interestRate = contacted > 0 ? Math.round((interested / contacted) * 100) : 0
  return { contacted, interested, notInterested, replied, responseRate, interestRate }
}

function pipelineMetrics(rows: PipelineRow[]): PipelineMetrics {
  const won = rows.filter((p) => p.stage === 'vinto')
  const lost = rows.filter((p) => p.stage === 'perso')
  const active = rows.filter((p) => !['vinto', 'perso'].includes(String(p.stage ?? '')))
  const totalRevenue = won.reduce((s, p) => s + (Number((p as any).deal_value) || 0), 0)
  const pipelineValue = active.reduce((s, p) => s + (Number((p as any).deal_value) || 0), 0)
  const avgDealSize = won.length > 0 ? totalRevenue / won.length : 0
  const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0
  const stagnant = active.filter((p) => {
    const t = Date.parse(String(p.updated_at ?? ''))
    return Number.isFinite(t) && (Date.now() - t) / 86_400_000 > 7
  }).length
  const scores = rows.map((p) => Number(p.lead_score)).filter((n) => Number.isFinite(n) && n > 0)
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0

  return {
    total: rows.length,
    won: won.length,
    lost: lost.length,
    active: active.length,
    stagnant,
    pipelineValue,
    totalRevenue,
    avgDealSize,
    avgScore,
    winRate,
  }
}

function meshFromEnvironmentStats(envs: Array<{ stats?: Record<string, unknown> | null }>): ReturnType<typeof buildEnvironmentMesh> {
  const synthetic: LeadMeshInput[] = []
  for (const env of envs) {
    const st = env.stats ?? {}
    const total = Number(st.total_leads) || 0
    const noPixel = Number(st.leads_no_pixel) || 0
    const withEmail = Number(st.leads_with_email) || 0
    const avg = Number(st.avg_score) || 0
    for (let i = 0; i < total; i++) {
      synthetic.push({
        meta_pixel: i >= noPixel,
        email: i < withEmail ? 'x@y.it' : '',
        opportunity_score: avg,
      })
    }
  }
  return buildEnvironmentMesh(synthetic)
}

export async function loadInsightsSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<InsightsSnapshot> {
  const [pipelineRes, outreachRes, envRes, knowledgeRes] = await Promise.all([
    supabase
      .from('lead_pipeline')
      .select('stage, deal_value, lead_score, lead_website, lead_name, updated_at, created_at, last_outreach_channel')
      .eq('user_id', userId)
      .limit(500),
    supabase
      .from('outreach_log')
      .select('lead_website, lead_name, channel, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('environments').select('stats').eq('user_id', userId),
    supabase.from('knowledge_objects').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  const pipelineRows = (pipelineRes.data ?? []) as PipelineRow[]
  const outreachRows = (outreachRes.data ?? []) as OutreachRow[]
  const envs = envRes.data ?? []

  const pipeline = pipelineMetrics(pipelineRows)
  const outreach = outreachMetrics(outreachRows)
  const totalLeads = envs.reduce((s, e) => s + (Number((e.stats as any)?.total_leads) || 0), 0)
  const closurePatterns = analyzeClosurePatterns(pipelineRows, outreachRows)
  const mesh = meshFromEnvironmentStats(envs)

  const pki = computePKI({
    pipeline: {
      total: pipeline.total,
      won: pipeline.won,
      lost: pipeline.lost,
      active: pipeline.active,
      stagnant: pipeline.stagnant,
      pipelineValue: pipeline.pipelineValue,
      avgScore: pipeline.avgScore,
    },
    outreach,
    environments: { count: envs.length, totalLeads },
    knowledge: { count: knowledgeRes.count ?? 0 },
    mesh,
    closurePatterns,
  })

  return {
    pipeline,
    outreach,
    environments: { count: envs.length, totalLeads },
    knowledge: { count: knowledgeRes.count ?? 0 },
    closurePatterns,
    mesh,
    pki,
  }
}
