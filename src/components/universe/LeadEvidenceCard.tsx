'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeDollarSign,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Mail,
  Megaphone,
  Phone,
  Rocket,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getEntityPii } from '@/lib/universe/client'
import { Network } from 'lucide-react'

export type CommercialSignalUi = {
  type: string
  score: number
  confidence: number
  summary: string
}

export type EvidenceUi = {
  claim: string
  source_type: string
  source: string
  observed_at: string
}

export type PathEvidenceUi = {
  from_entity_name: string
  relationship_type: string
  to_entity_name: string
}

type Props = {
  opportunityScore: number
  graphScore: number
  intentFitScore?: number | null
  signals: CommercialSignalUi[]
  evidence: EvidenceUi[]
  pathEvidence?: PathEvidenceUi[]
  reasoning?: string | null
  entityId?: string | null
  className?: string
}

const SIGNAL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  growth: TrendingUp,
  buying: BadgeDollarSign,
  digital_transformation: BrainCircuit,
  budget: Megaphone,
  urgency: Zap,
  pain: AlertTriangle,
  intent_fit: Target,
}

const SIGNAL_LABELS: Record<string, string> = {
  growth: 'Crescita',
  buying: "Intenzione d'acquisto",
  digital_transformation: 'Trasformazione digitale',
  budget: 'Budget',
  urgency: 'Urgenza',
  pain: 'Dolore / gap',
  intent_fit: 'Match intent',
}

const SIGNAL_COLORS: Record<string, string> = {
  growth: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  buying: 'bg-rose-50 text-rose-800 border-rose-200',
  digital_transformation: 'bg-violet-50 text-violet-800 border-violet-200',
  budget: 'bg-amber-50 text-amber-800 border-amber-200',
  urgency: 'bg-orange-50 text-orange-800 border-orange-200',
  pain: 'bg-slate-100 text-slate-800 border-slate-200',
  intent_fit: 'bg-sky-50 text-sky-800 border-sky-200',
}

function ScoreRing({ value, label, colorClass }: { value: number; label: string; colorClass: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-bold',
          colorClass,
        )}
      >
        {value}
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  )
}

export function LeadEvidenceCard({
  opportunityScore,
  graphScore,
  intentFitScore,
  signals,
  evidence,
  pathEvidence,
  reasoning,
  entityId,
  className,
}: Props) {
  const [showEvidence, setShowEvidence] = useState(false)
  const [pii, setPii] = useState<{ phone: string | null; email: string | null; pec_email: string | null; mobile_phone: string | null } | null>(null)
  const [piiLoading, setPiiLoading] = useState(false)
  const topSignals = signals.slice(0, 3)

  const loadPii = async () => {
    if (!entityId || pii) return
    setPiiLoading(true)
    try {
      const res = await getEntityPii(entityId)
      setPii(res.pii)
    } catch {
      /* ignore */
    } finally {
      setPiiLoading(false)
    }
  }

  const scoreColor =
    opportunityScore >= 80 ? 'border-emerald-500 text-emerald-700 bg-emerald-50' :
    opportunityScore >= 55 ? 'border-amber-500 text-amber-700 bg-amber-50' :
    'border-slate-300 text-slate-700 bg-slate-50'

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md',
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-4">
        <ScoreRing value={opportunityScore} label="Opportunity" colorClass={scoreColor} />
        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-slate-900">Perché questo lead</h4>
            {intentFitScore ? (
              <Badge variant="outline" className="text-[10px] border-sky-200 text-sky-700 bg-sky-50">
                Fit intent {intentFitScore}%
              </Badge>
            ) : null}
          </div>
          {reasoning ? (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{reasoning}</p>
          ) : (
            <p className="mt-1.5 text-sm text-slate-500">Nessun reasoning disponibile.</p>
          )}

          {topSignals.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {topSignals.map((s, idx) => {
                const Icon = SIGNAL_ICONS[s.type] || Sparkles
                const label = SIGNAL_LABELS[s.type] || s.type
                return (
                  <span
                    key={`${s.type}-${idx}`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                      SIGNAL_COLORS[s.type] || 'bg-slate-50 text-slate-800 border-slate-200',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {label} · {s.score}
                  </span>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      {pathEvidence && pathEvidence.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Network className="h-3.5 w-3.5" />
            Percorso grafo
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pathEvidence.map((hop, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-800"
              >
                <span className="font-semibold">{hop.from_entity_name}</span>
                <span className="text-violet-400">·</span>
                <span className="text-violet-600">{hop.relationship_type}</span>
                <span className="text-violet-400">·</span>
                <span className="font-semibold">{hop.to_entity_name}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Lightbulb className="h-3.5 w-3.5" />
              Evidenze ({evidence.length})
            </span>
            {showEvidence ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {showEvidence ? (
            <ul className="mt-2 space-y-2">
              {evidence.map((e, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 rounded-lg bg-slate-50/70 px-3 py-2 text-xs text-slate-700"
                >
                  <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
                  <div className="flex-1">
                    <p className="font-medium">{e.claim}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {e.source_type} · {e.source}
                      {e.observed_at ? ` · ${new Date(e.observed_at).toLocaleDateString('it-IT')}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {entityId ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {!pii ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={piiLoading}
              onClick={loadPii}
            >
              {piiLoading ? <Rocket className="h-3 w-3 animate-spin" /> : <Phone className="h-3 w-3" />}
              Mostra contatti
            </Button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {pii.phone ? (
                <a
                  href={`tel:${pii.phone}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <Phone className="h-3.5 w-3.5 text-violet-500" />
                  {pii.phone}
                </a>
              ) : null}
              {pii.email ? (
                <a
                  href={`mailto:${pii.email}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <Mail className="h-3.5 w-3.5 text-violet-500" />
                  {pii.email}
                </a>
              ) : null}
              {pii.pec_email ? (
                <a
                  href={`mailto:${pii.pec_email}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <Mail className="h-3.5 w-3.5 text-amber-500" />
                  PEC: {pii.pec_email}
                </a>
              ) : null}
              {pii.mobile_phone ? (
                <a
                  href={`tel:${pii.mobile_phone}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <Phone className="h-3.5 w-3.5 text-emerald-500" />
                  Mobile: {pii.mobile_phone}
                </a>
              ) : null}
              {!pii.phone && !pii.email && !pii.pec_email && !pii.mobile_phone ? (
                <p className="text-xs text-slate-500">Nessun contatto disponibile nel grafo.</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
