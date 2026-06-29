'use client'

import { Brain, Sparkles } from 'lucide-react'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { describeSignalIntent } from '@/lib/signal-intent'
import { collectIntentChips, labelParseSource } from '@/lib/universe/agentic-ui'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Props = {
  intent: SignalIntentSpec
  intentSummary: string
  parseSource: string
  className?: string
}

export function AgenticIntentBreakdown({ intent, intentSummary, parseSource, className }: Props) {
  const chips = collectIntentChips(intent)
  const reasoning = describeSignalIntent(intent) || intentSummary

  return (
    <div className={cn('rounded-xl border border-violet-200/80 bg-gradient-to-br from-violet-50/90 to-white p-4', className)}>
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
        <Badge variant="outline" className="border-violet-200 bg-white text-violet-800 text-[10px]">
          <Sparkles className="h-3 w-3 mr-1" />
          Agentic Search
        </Badge>
      </div>

      {reasoning ? (
        <p className="mt-3 text-sm leading-relaxed text-slate-700">{reasoning}</p>
      ) : null}

      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="inline-flex rounded-full border border-violet-200/80 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-900"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Ricerca generica sul grafo — nessun filtro segnale specifico.</p>
      )}
    </div>
  )
}
