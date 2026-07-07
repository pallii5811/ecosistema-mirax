'use client'

import { Brain, Sparkles, Target, TrendingUp } from 'lucide-react'
import type { CommercialIntent } from '@/lib/signal-intent/commercial-intent'
import { collectCommercialIntentChips, labelParseSource } from '@/lib/universe/agentic-ui'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Props = {
  intent: CommercialIntent
  intentSummary: string
  parseSource: string
  className?: string
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  let color = 'bg-slate-400'
  if (pct >= 80) color = 'bg-emerald-500'
  else if (pct >= 50) color = 'bg-amber-500'

  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-600">
      <span className="whitespace-nowrap">Confidenza</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-medium text-slate-800">{pct}%</span>
    </div>
  )
}

export function CommercialIntentBreakdown({ intent, intentSummary, parseSource, className }: Props) {
  const chips = collectCommercialIntentChips(intent)

  return (
    <div
      className={cn(
        'rounded-xl border border-violet-200/80 bg-gradient-to-br from-violet-50/90 to-white p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white">
            <Brain className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-violet-950">Cosa ha capito MIRAX</p>
            <p className="text-[11px] text-violet-700">{labelParseSource(parseSource)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBar value={intent.confidence} />
          <Badge variant="outline" className="border-violet-200 bg-white text-violet-800 text-[10px]">
            <Sparkles className="h-3 w-3 mr-1" />
            NL Intelligence
          </Badge>
        </div>
      </div>

      {intentSummary || intent.reasoning ? (
        <p className="mt-3 text-sm leading-relaxed text-slate-700">
          {intentSummary || intent.reasoning}
        </p>
      ) : null}

      {intent.user_service_description ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-100 bg-white/70 px-3 py-2">
          <Target className="mt-0.5 h-3.5 w-3.5 text-violet-600" />
          <p className="text-xs text-slate-700">
            <span className="font-medium text-slate-900">Prodotto/servizio:</span>{' '}
            {intent.user_service_description}
          </p>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip, idx) => (
            <span
              key={`${chip}-${idx}`}
              className="inline-flex rounded-full border border-violet-200/80 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-900"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Ricerca generica sul grafo — nessun filtro specifico.</p>
      )}

      {intent.ranking_hint && intent.ranking_hint !== 'default' ? (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600">
          <TrendingUp className="h-3.5 w-3.5" />
          <span>
            Ordinamento preferito: <span className="font-medium text-slate-800">{intent.ranking_hint}</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}
