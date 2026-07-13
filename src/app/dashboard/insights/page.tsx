'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Brain, TrendingUp, Target, Zap, Trophy, Phone, CheckCircle, XCircle,
  Euro, ArrowUpRight, ArrowDownRight, Minus, BarChart3, Loader2, Lightbulb,
  Flame, Clock, MapPin, Sparkles, AlertTriangle, RefreshCw, ArrowRight, Rocket,
  Search,
} from 'lucide-react'

type PipelineItem = {
  id: string; stage: string; deal_value: number; lead_category: string | null
  lead_city: string | null; created_at: string; updated_at: string
}

type ConversionStats = {
  total_contacted: number
  total_converted: number
  total_rejected: number
  conversion_rate: number
  outreach_response_rate?: number
  outreach_interest_rate?: number
  pki_score?: number
  pki_grade?: string
  closure_patterns?: Array<{
    signal: string
    label: string
    liftPts: number
    segmentWinRate: number
    baselineWinRate: number
  }>
}

type PKIData = {
  score: number
  grade: string
  components: Record<string, number>
  signals: Array<{ key: string; label: string; value: number; unit: string; trend: string }>
  top_lift_pattern: { label: string; liftPts: number; segmentWinRate: number } | null
}

type AIInsight = {
  icon: 'trend' | 'risk' | 'opportunity' | 'win' | 'focus'
  title: string
  body: string
  severity: 'info' | 'warning' | 'success' | 'critical'
}

type AIInsightsResponse = {
  insights: AIInsight[]
  usedAI: boolean
  generatedAt: string
}

type ActionItem = {
  type: 'stagnant' | 'urgent_proposal' | 'hot_uncontacted' | 'meeting_followup'
  severity: 'critical' | 'warning' | 'info'
  title: string
  body: string
  cta: { label: string; href: string }
  count: number
  examples: string[]
}

type Forecast = {
  pipelineValue: number
  winRate: number
  expectedRevenue: number
  confidenceLevel: 'low' | 'medium' | 'high'
  dealsAtRisk: number
}

type ActionsResponse = {
  actions: ActionItem[]
  forecast: Forecast | null
  totalActive: number
  totalWon: number
  totalLost: number
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

function TrendIndicator({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value > 0) return <span className="text-emerald-600 text-xs font-bold flex items-center gap-0.5"><ArrowUpRight className="w-3 h-3" />+{value}{suffix}</span>
  if (value < 0) return <span className="text-red-500 text-xs font-bold flex items-center gap-0.5"><ArrowDownRight className="w-3 h-3" />{value}{suffix}</span>
  return <span className="text-slate-400 text-xs flex items-center gap-0.5"><Minus className="w-3 h-3" />0{suffix}</span>
}

function InsightCard({ icon: Icon, color, title, children }: { icon: any; color: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

const AI_ICON_MAP = {
  trend: TrendingUp,
  risk: AlertTriangle,
  opportunity: Lightbulb,
  win: Trophy,
  focus: Target,
} as const

const AI_SEVERITY_STYLES: Record<AIInsight['severity'], { badge: string; iconBg: string; iconText: string; cardBorder: string }> = {
  info: {
    badge: 'bg-slate-50 text-slate-600 border-slate-200',
    iconBg: 'bg-slate-100',
    iconText: 'text-slate-600',
    cardBorder: 'border-slate-200',
  },
  warning: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    iconBg: 'bg-amber-100',
    iconText: 'text-amber-700',
    cardBorder: 'border-amber-200',
  },
  success: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    iconBg: 'bg-emerald-100',
    iconText: 'text-emerald-700',
    cardBorder: 'border-emerald-200',
  },
  critical: {
    badge: 'bg-red-50 text-red-700 border-red-200',
    iconBg: 'bg-red-100',
    iconText: 'text-red-700',
    cardBorder: 'border-red-200',
  },
}

function AIInsightCard({ insight }: { insight: AIInsight }) {
  const Icon = AI_ICON_MAP[insight.icon] ?? Target
  const s = AI_SEVERITY_STYLES[insight.severity] ?? AI_SEVERITY_STYLES.info
  return (
    <div className="bg-white p-4 hover:bg-slate-50/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${s.iconBg}`}>
          <Icon className={`w-4 h-4 ${s.iconText}`} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900 leading-tight">{insight.title}</div>
          <div className="text-xs text-slate-600 mt-1 leading-relaxed">{insight.body}</div>
        </div>
      </div>
    </div>
  )
}

const SEVERITY_STYLE: Record<ActionItem['severity'], { card: string; icon: string; iconBg: string; badge: string; accent: string }> = {
  critical: {
    card: 'border-slate-200 bg-white',
    icon: 'text-red-600',
    iconBg: 'bg-red-50 border border-red-100',
    badge: 'bg-red-50 text-red-700 border-red-200',
    accent: 'bg-red-500',
  },
  warning: {
    card: 'border-slate-200 bg-white',
    icon: 'text-amber-600',
    iconBg: 'bg-amber-50 border border-amber-100',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    accent: 'bg-amber-500',
  },
  info: {
    card: 'border-slate-200 bg-white',
    icon: 'text-blue-600',
    iconBg: 'bg-blue-50 border border-blue-100',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    accent: 'bg-blue-500',
  },
}

const ACTION_ICON_MAP = {
  stagnant: Clock,
  urgent_proposal: Zap,
  hot_uncontacted: Flame,
  meeting_followup: Phone,
} as const

function formatCompactCurrency(v: number): string {
  if (v >= 1000) return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 1, notation: 'compact' }).format(v)
  return formatCurrency(v)
}

export default function InsightsPage() {
  const [pipeline, setPipeline] = useState<PipelineItem[]>([])
  const [stats, setStats] = useState<ConversionStats | null>(null)
  const [pkiData, setPkiData] = useState<PKIData | null>(null)
  const [aiData, setAiData] = useState<AIInsightsResponse | null>(null)
  const [actionsData, setActionsData] = useState<ActionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)

  const loadAI = async () => {
    setAiLoading(true)
    try {
      const res = await fetch('/api/insights/ai', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (data && Array.isArray(data.insights)) setAiData(data as AIInsightsResponse)
    } catch {
      /* fallback gestito server-side */
    } finally {
      setAiLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/pipeline', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ items: [] })),
      fetch('/api/insights/stats', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      fetch('/api/insights/actions', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      fetch('/api/insights/pki', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([pData, sData, aData, pki]) => {
      setPipeline(pData?.items || [])
      setStats(sData)
      if (aData && Array.isArray(aData.actions)) setActionsData(aData as ActionsResponse)
      if (pki && typeof pki.score === 'number') setPkiData(pki as PKIData)
      setLoading(false)
      loadAI()
    })
  }, [])

  const insights = useMemo(() => {
    const won = pipeline.filter(p => p.stage === 'vinto')
    const lost = pipeline.filter(p => p.stage === 'perso')
    const active = pipeline.filter(p => !['vinto', 'perso'].includes(p.stage))
    const totalRevenue = won.reduce((s, p) => s + (p.deal_value || 0), 0)
    const pipelineValue = active.reduce((s, p) => s + (p.deal_value || 0), 0)
    const avgDealSize = won.length > 0 ? Math.round(totalRevenue / won.length) : 0
    const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

    // Category analysis
    const catMap = new Map<string, { won: number; total: number; revenue: number }>()
    for (const p of pipeline) {
      const cat = p.lead_category || 'Altro'
      const existing = catMap.get(cat) || { won: 0, total: 0, revenue: 0 }
      existing.total++
      if (p.stage === 'vinto') { existing.won++; existing.revenue += p.deal_value || 0 }
      catMap.set(cat, existing)
    }
    const bestCategories = Array.from(catMap.entries())
      .map(([cat, d]) => ({ category: cat, winRate: d.total > 0 ? Math.round((d.won / d.total) * 100) : 0, revenue: d.revenue, total: d.total }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    // City analysis
    const cityMap = new Map<string, number>()
    for (const p of pipeline) {
      const city = p.lead_city || 'Altro'
      cityMap.set(city, (cityMap.get(city) || 0) + 1)
    }
    const topCities = Array.from(cityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    // Stage funnel
    const funnel = [
      { stage: 'Nuovo', count: pipeline.filter(p => p.stage === 'nuovo').length },
      { stage: 'Contattato', count: pipeline.filter(p => p.stage === 'contattato').length },
      { stage: 'Meeting', count: pipeline.filter(p => p.stage === 'meeting').length },
      { stage: 'Proposta', count: pipeline.filter(p => p.stage === 'proposta').length },
      { stage: 'Vinto', count: won.length },
      { stage: 'Perso', count: lost.length },
    ]
    const maxFunnel = Math.max(...funnel.map(f => f.count), 1)

    return { totalRevenue, pipelineValue, avgDealSize, winRate, won: won.length, lost: lost.length, active: active.length, bestCategories, topCities, funnel, maxFunnel }
  }, [pipeline])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Analisi in corso...</span>
      </div>
    )
  }

  const hasData = pipeline.length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Sales Command Center</h1>
        <p className="mt-1 text-sm text-slate-500">
          Il tuo centro di comando commerciale: cosa fare adesso per chiudere più deal questo mese.
        </p>
      </div>

      {/* Empty state: guida l'utente se non ha ancora dati */}
      {!hasData && (
        <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
          <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-4">
            <Brain className="w-6 h-6 text-slate-400" strokeWidth={1.75} />
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            Il tuo Sales Command Center ti aspetta
          </h2>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
            Una volta aggiunti i primi lead alla Pipeline, qui vedrai forecast del mese, azioni urgenti, pattern di conversione e consigli MIRAX AI personalizzati sui tuoi dati reali.
          </p>
          <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
            >
              <Search className="w-4 h-4" /> Fai la prima ricerca
            </Link>
            <Link
              href="/dashboard/pipeline"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Vai alla Pipeline <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      {/* PKI — Performance Analysis Indicator */}
      {hasData && pkiData && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
              <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">PKI — Performance Index</span>
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
              pkiData.grade === 'A' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : pkiData.grade === 'B' ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : pkiData.grade === 'C' ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}>
              Grado {pkiData.grade}
            </span>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
            <div className="flex flex-col items-center justify-center">
              <div className="text-4xl font-bold text-slate-900 tabular-nums">{pkiData.score}</div>
              <div className="text-xs text-slate-500 mt-1">/ 100</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(pkiData.components).map(([key, val]) => (
                <div key={key} className="bg-slate-50 rounded-md px-3 py-2 border border-slate-100">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide truncate">
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 tabular-nums">{val}</div>
                </div>
              ))}
            </div>
          </div>
          {pkiData.top_lift_pattern && (
            <div className="px-5 pb-4">
              <p className="text-xs text-slate-600 bg-violet-50 border border-violet-100 rounded-md px-3 py-2">
                <span className="font-semibold text-violet-800">Pattern vincente:</span>{' '}
                {pkiData.top_lift_pattern.label} — win rate {pkiData.top_lift_pattern.segmentWinRate}%
                ({pkiData.top_lift_pattern.liftPts > 0 ? '+' : ''}{pkiData.top_lift_pattern.liftPts} pt vs baseline)
              </p>
            </div>
          )}
        </div>
      )}

      {/* FORECAST HERO */}
      {hasData && actionsData?.forecast && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
              <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">Forecast del mese</span>
            </div>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded ${
              actionsData.forecast.confidenceLevel === 'high'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : actionsData.forecast.confidenceLevel === 'medium'
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-slate-50 text-slate-600 border border-slate-200'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                actionsData.forecast.confidenceLevel === 'high' ? 'bg-emerald-500'
                  : actionsData.forecast.confidenceLevel === 'medium' ? 'bg-amber-500' : 'bg-slate-400'
              }`} />
              Affidabilità {
                actionsData.forecast.confidenceLevel === 'high' ? 'alta'
                  : actionsData.forecast.confidenceLevel === 'medium' ? 'media' : 'bassa'
              }
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-200">
            <div className="bg-white px-5 py-4">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Revenue prevista</div>
              <div className="text-3xl md:text-4xl font-semibold mt-1 tracking-tight text-slate-900 tabular-nums">
                {formatCompactCurrency(actionsData.forecast.expectedRevenue)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Su pipeline attiva di <span className="font-medium text-slate-700 tabular-nums">{formatCompactCurrency(actionsData.forecast.pipelineValue)}</span>
              </div>
            </div>
            <div className="bg-white px-5 py-4">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Win rate applicato</div>
              <div className="text-3xl md:text-4xl font-semibold mt-1 tracking-tight text-slate-900 tabular-nums">
                {actionsData.forecast.winRate}%
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {(actionsData.totalWon + actionsData.totalLost) < 3
                  ? 'Base media B2B italiana (pochi dati)'
                  : `Basato su ${actionsData.totalWon + actionsData.totalLost} chiusure`}
              </div>
            </div>
            <div className="bg-white px-5 py-4">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Deal a rischio</div>
              <div className="text-3xl md:text-4xl font-semibold mt-1 tracking-tight text-slate-900 tabular-nums">
                {actionsData.forecast.dealsAtRisk}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Stagnanti o proposte in attesa
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AZIONI URGENTI */}
      {hasData && actionsData && actionsData.actions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Azioni urgenti</h2>
            <span className="text-[11px] font-semibold tabular-nums text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
              {actionsData.actions.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {actionsData.actions.map((action, i) => {
              const Icon = ACTION_ICON_MAP[action.type] || Target
              const s = SEVERITY_STYLE[action.severity]
              return (
                <div key={i} className={`relative overflow-hidden rounded-lg border p-4 ${s.card}`}>
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.accent}`} aria-hidden="true" />
                  <div className="flex items-start gap-3 pl-2">
                    <div className={`flex-shrink-0 w-9 h-9 rounded-md ${s.iconBg} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${s.icon}`} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-slate-900">{action.title}</h3>
                        <span className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${s.badge}`}>
                          {action.severity === 'critical' ? 'Urgente' : action.severity === 'warning' ? 'Importante' : 'Da fare'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{action.body}</p>
                      {action.examples.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {action.examples.slice(0, 3).map((name) => (
                            <span key={name} className="text-[11px] bg-slate-50 border border-slate-200 text-slate-700 px-2 py-0.5 rounded truncate max-w-[160px]">
                              {name}
                            </span>
                          ))}
                          {action.count > 3 && (
                            <span className="text-[11px] text-slate-500 self-center">+{action.count - 3} altri</span>
                          )}
                        </div>
                      )}
                      <Link
                        href={action.cta.href}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-900 hover:text-slate-700 transition-colors"
                      >
                        {action.cta.label} <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tutto ok: nessuna azione urgente */}
      {hasData && actionsData && actionsData.actions.length === 0 && (
        <div className="relative overflow-hidden bg-white border border-slate-200 rounded-lg p-4 flex items-start gap-3">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" aria-hidden="true" />
          <div className="w-9 h-9 rounded-md bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0 ml-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" strokeWidth={1.75} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Pipeline in salute</h3>
            <p className="text-xs text-slate-600 mt-1">
              Nessun deal fermo, nessuna proposta in ritardo, nessun lead caldo non contattato. Continua così.
            </p>
          </div>
        </div>
      )}

      {/* AI Coach */}
      {hasData && aiData?.usedAI && aiData.insights.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2} />
              </div>
              <span className="text-sm font-semibold text-slate-900">Sales Coach AI</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> MIRAX AI
              </span>
            </div>
            <button
              type="button"
              onClick={loadAI}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors"
              title="Rigenera insight"
            >
              <RefreshCw className={`w-3 h-3 ${aiLoading ? 'animate-spin' : ''}`} />
              Rigenera
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-200">
            {aiData.insights.map((ins, i) => (
              <AIInsightCard key={i} insight={ins} />
            ))}
          </div>
        </div>
      )}

      {/* Loading AI (solo se non abbiamo ancora dati AI) */}
      {hasData && aiLoading && !aiData && (
        <div className="flex items-center gap-2 text-sm text-slate-500 bg-white rounded-lg border border-slate-200 p-4">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> Il Sales Coach AI sta analizzando i tuoi dati…
        </div>
      )}

      {/* KPI Row */}
      {hasData && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
        {[
          { label: 'Revenue Totale', value: formatCurrency(insights.totalRevenue), icon: Euro },
          { label: 'Pipeline Attiva', value: formatCurrency(insights.pipelineValue), icon: TrendingUp },
          { label: 'Deal Medio', value: formatCurrency(insights.avgDealSize), icon: Target },
          { label: 'Win Rate', value: `${insights.winRate}%`, icon: Trophy },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <kpi.icon className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} />
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{kpi.label}</span>
            </div>
            <div className="text-xl font-semibold text-slate-900 tabular-nums">{kpi.value}</div>
          </div>
        ))}
      </div>
      )}

      {hasData && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion Funnel */}
        <InsightCard icon={BarChart3} color="bg-indigo-500" title="Funnel di Conversione">
          <div className="space-y-2.5">
            {insights.funnel.map(f => (
              <div key={f.stage} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-20 font-medium">{f.stage}</span>
                <div className="flex-1 bg-slate-100 rounded h-5 overflow-hidden">
                  <div
                    className="h-full bg-slate-900 rounded transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(8, (f.count / insights.maxFunnel) * 100)}%` }}
                  >
                    {f.count > 0 && <span className="text-[10px] font-semibold text-white tabular-nums">{f.count}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </InsightCard>

        {/* Best Categories */}
        <InsightCard icon={Flame} color="bg-orange-500" title="Categorie Migliori">
          {insights.bestCategories.length > 0 ? (
            <div className="space-y-2.5">
              {insights.bestCategories.map((cat, i) => (
                <div key={cat.category} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-semibold text-slate-400 tabular-nums w-5">{i + 1}.</span>
                    <span className="text-sm font-medium text-slate-700 truncate">{cat.category}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-slate-500 tabular-nums">{cat.total} deal</span>
                    {cat.revenue > 0 && <span className="text-[11px] font-semibold text-slate-900 tabular-nums">{formatCurrency(cat.revenue)}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Aggiungi lead con categorie alla pipeline per vedere i dati.</p>
          )}
        </InsightCard>

        {/* Top Cities */}
        <InsightCard icon={MapPin} color="bg-cyan-500" title="Città Principali">
          {insights.topCities.length > 0 ? (
            <div className="space-y-2.5">
              {insights.topCities.map(([city, count], i) => (
                <div key={city} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-semibold text-slate-400 tabular-nums w-5">{i + 1}.</span>
                    <span className="text-sm font-medium text-slate-700 truncate">{city}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums">{count} lead</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Aggiungi lead con città alla pipeline per vedere i dati.</p>
          )}
        </InsightCard>

        {/* Conversion Stats from outreach + pipeline */}
        <InsightCard icon={Target} color="bg-violet-500" title="Attività di Outreach">
          {stats ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
                <div className="bg-white p-3">
                  <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1"><Phone className="w-3 h-3" strokeWidth={1.75} /> Contattati</div>
                  <div className="text-xl font-semibold text-slate-900 tabular-nums">{stats.total_contacted}</div>
                </div>
                <div className="bg-white p-3">
                  <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1"><CheckCircle className="w-3 h-3 text-emerald-500" strokeWidth={1.75} /> Vinti</div>
                  <div className="text-xl font-semibold text-slate-900 tabular-nums">{stats.total_converted}</div>
                </div>
                <div className="bg-white p-3">
                  <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1"><XCircle className="w-3 h-3 text-red-500" strokeWidth={1.75} /> Persi</div>
                  <div className="text-xl font-semibold text-slate-900 tabular-nums">{stats.total_rejected}</div>
                </div>
                <div className="bg-white p-3">
                  <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1"><TrendingUp className="w-3 h-3" strokeWidth={1.75} /> Win rate</div>
                  <div className="text-xl font-semibold text-slate-900 tabular-nums">{stats.conversion_rate}%</div>
                </div>
              </div>
              {(stats.outreach_interest_rate ?? 0) > 0 && (
                <p className="text-xs text-slate-600">
                  Tasso interesse outreach: <span className="font-semibold">{stats.outreach_interest_rate}%</span>
                  {stats.outreach_response_rate ? ` · Risposte: ${stats.outreach_response_rate}%` : ''}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Contatta lead dalla tabella risultati per tracciare le conversioni.</p>
          )}
        </InsightCard>

        {/* Closure patterns */}
        {stats?.closure_patterns && stats.closure_patterns.length > 0 && (
          <InsightCard icon={Zap} color="bg-amber-500" title="Pattern di Chiusura">
            <div className="space-y-2">
              {stats.closure_patterns.map((p) => (
                <div key={p.signal} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700 truncate">{p.label}</span>
                  <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${p.liftPts > 0 ? 'text-emerald-600' : p.liftPts < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                    {p.liftPts > 0 ? '+' : ''}{p.liftPts} pt ({p.segmentWinRate}%)
                  </span>
                </div>
              ))}
            </div>
          </InsightCard>
        )}
      </div>
      )}
    </div>
  )
}
