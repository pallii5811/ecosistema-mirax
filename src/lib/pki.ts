/**
 * Blocco 6 — PKI (Performance Analysis Indicator) MIRAX.
 * Score composito 0–100 da metriche reali (no mock).
 */

import type { ClosurePattern } from '@/lib/closure-patterns'
import type { EnvironmentMeshReport } from '@/lib/environment-correlations'

export type PKIComponents = {
  conversion: number
  pipeline_velocity: number
  outreach_quality: number
  market_coverage: number
  knowledge_depth: number
}

export type PKISignal = {
  key: string
  label: string
  value: number
  unit: string
  trend: 'up' | 'down' | 'flat'
}

export type PKIReport = {
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  components: PKIComponents
  signals: PKISignal[]
  closure_patterns: ClosurePattern[]
  top_lift_pattern: ClosurePattern | null
  generated_at: string
}

export type PKIInput = {
  pipeline: {
    total: number
    won: number
    lost: number
    active: number
    stagnant: number
    pipelineValue: number
    avgScore: number
  }
  outreach: {
    contacted: number
    interested: number
    notInterested: number
    responseRate: number
    interestRate: number
  }
  environments: { count: number; totalLeads: number }
  knowledge: { count: number }
  mesh?: EnvironmentMeshReport | null
  closurePatterns: ClosurePattern[]
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)))
}

function gradeFromScore(score: number): PKIReport['grade'] {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

export function computePKI(input: PKIInput): PKIReport {
  if (input.pipeline.total === 0 && input.outreach.contacted === 0 && input.environments.count === 0) {
    return {
      score: 0,
      grade: 'F',
      components: {
        conversion: 0,
        pipeline_velocity: 0,
        outreach_quality: 0,
        market_coverage: 0,
        knowledge_depth: 0,
      },
      signals: [],
      closure_patterns: input.closurePatterns,
      top_lift_pattern: null,
      generated_at: new Date().toISOString(),
    }
  }

  const winDenom = input.pipeline.won + input.pipeline.lost
  const winRate = winDenom > 0 ? (input.pipeline.won / winDenom) * 100 : 0

  const conversion = clamp(
    winRate * 0.55 +
      input.outreach.interestRate * 0.25 +
      input.outreach.responseRate * 0.2,
  )

  const stagnantPct =
    input.pipeline.active > 0 ? (input.pipeline.stagnant / input.pipeline.active) * 100 : 0
  const pipeline_velocity = clamp(100 - stagnantPct * 1.2 + Math.min(20, input.pipeline.active * 2))

  const outreach_quality = clamp(
    input.outreach.responseRate * 0.5 + input.outreach.interestRate * 0.5,
  )

  const market_coverage = clamp(
    Math.min(40, input.environments.count * 8) +
      Math.min(35, input.environments.totalLeads / 2) +
      Math.min(25, (input.mesh?.categories.length ?? 0) * 5),
  )

  const knowledge_depth = clamp(Math.min(100, input.knowledge.count * 6))

  const components: PKIComponents = {
    conversion,
    pipeline_velocity,
    outreach_quality,
    market_coverage,
    knowledge_depth,
  }

  const score = clamp(
    conversion * 0.3 +
      pipeline_velocity * 0.25 +
      outreach_quality * 0.2 +
      market_coverage * 0.15 +
      knowledge_depth * 0.1,
  )

  const topLift = input.closurePatterns.find((p) => p.liftPts > 0) ?? null

  const signals: PKISignal[] = [
    {
      key: 'win_rate',
      label: 'Win rate pipeline',
      value: Math.round(winRate),
      unit: '%',
      trend: winRate >= 30 ? 'up' : winRate > 0 ? 'flat' : 'down',
    },
    {
      key: 'interest_rate',
      label: 'Tasso interesse outreach',
      value: input.outreach.interestRate,
      unit: '%',
      trend: input.outreach.interestRate >= 20 ? 'up' : 'flat',
    },
    {
      key: 'stagnant_deals',
      label: 'Deal stagnanti (>7g)',
      value: input.pipeline.stagnant,
      unit: '',
      trend: input.pipeline.stagnant >= 3 ? 'down' : 'up',
    },
    {
      key: 'avg_score',
      label: 'Score medio pipeline',
      value: input.pipeline.avgScore,
      unit: '/100',
      trend: input.pipeline.avgScore >= 60 ? 'up' : 'flat',
    },
    {
      key: 'knowledge_objects',
      label: 'Knowledge objects',
      value: input.knowledge.count,
      unit: '',
      trend: input.knowledge.count >= 5 ? 'up' : 'flat',
    },
  ]

  return {
    score,
    grade: gradeFromScore(score),
    components,
    signals,
    closure_patterns: input.closurePatterns,
    top_lift_pattern: topLift,
    generated_at: new Date().toISOString(),
  }
}
