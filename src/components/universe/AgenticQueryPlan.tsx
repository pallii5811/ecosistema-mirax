'use client'

import { ChevronDown, ChevronUp, Filter, GitBranch, Layers, ListFilter } from 'lucide-react'
import { useState } from 'react'
import type { UniverseQuery } from '@/lib/universe/query-builder'
import { buildUniverseQueryPlan } from '@/lib/universe/agentic-ui'
import { cn } from '@/lib/utils'

type Props = {
  query: UniverseQuery
  className?: string
}

const ICONS = {
  filter: Filter,
  observation: ListFilter,
  relationship: GitBranch,
  limit: Layers,
} as const

export function AgenticQueryPlan({ query, className }: Props) {
  const [open, setOpen] = useState(false)
  const steps = buildUniverseQueryPlan(query)
  const panelId = 'agentic-query-plan-steps'

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-slate-50/80', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Piano query sul grafo
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open ? (
        <ol id={panelId} className="space-y-2 border-t border-slate-200 px-4 py-3">
          {steps.map((step, i) => {
            const Icon = ICONS[step.icon]
            return (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 text-violet-600">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="font-medium text-slate-800">{step.label}</p>
                  {step.detail ? <p className="text-xs text-slate-500 mt-0.5">{step.detail}</p> : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
