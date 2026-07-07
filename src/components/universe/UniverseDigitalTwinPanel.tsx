'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bookmark,
  Bot,
  Briefcase,
  Cpu,
  Loader2,
  Mail,
  Network,
  Sparkles,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  getUniverseDigitalTwin,
  removeUniverseUserContext,
  runUniverseAgentPipeline,
  setUniverseUserContext,
  type DigitalTwinResponse,
} from '@/lib/universe/client'
import { formatObservationValue, labelEvent, labelObservation } from '@/lib/universe/labels'
import { UniverseLiveEventsFeed } from './UniverseLiveEventsFeed'
import { cn } from '@/lib/utils'

type Props = {
  entityId: string
}

type ContextType = 'saved' | 'pipeline' | 'contacted'

function ExpandableList<T extends { entity_id: string; name: string }>({
  items,
  initial = 5,
}: {
  items: T[]
  initial?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, initial)
  return (
    <>
      <ul className="mt-2 space-y-1">
        {shown.map((item) => (
          <li key={item.entity_id} className="text-sm text-slate-800">
            {item.name}
          </li>
        ))}
      </ul>
      {items.length > initial ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-violet-600 hover:text-violet-700"
        >
          {expanded ? 'Mostra meno' : `Mostra tutti (${items.length})`}
        </button>
      ) : null}
    </>
  )
}

const CONTEXT_ACTIONS: { type: ContextType; label: string; icon: typeof Bookmark }[] = [
  { type: 'saved', label: 'Salva', icon: Bookmark },
  { type: 'pipeline', label: 'Pipeline', icon: Briefcase },
  { type: 'contacted', label: 'Contattato', icon: Mail },
]

export function UniverseDigitalTwinPanel({ entityId }: Props) {
  const [twin, setTwin] = useState<DigitalTwinResponse['twin'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contextBusy, setContextBusy] = useState<ContextType | null>(null)
  const [pitchLoading, setPitchLoading] = useState(false)
  const [pitchResult, setPitchResult] = useState<{ subject?: string; body?: string } | null>(null)
  const [pitchError, setPitchError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getUniverseDigitalTwin(entityId)
      setTwin(data.twin)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore caricamento Digital Twin')
      setTwin(null)
    } finally {
      setLoading(false)
    }
  }, [entityId])

  useEffect(() => {
    void load()
  }, [load])

  const activeContexts = new Set(twin?.user_context.map((c) => c.context_type) ?? [])

  const toggleContext = async (type: ContextType) => {
    setContextBusy(type)
    try {
      if (activeContexts.has(type)) {
        await removeUniverseUserContext(entityId, type)
      } else {
        await setUniverseUserContext(entityId, type)
      }
      await load()
    } finally {
      setContextBusy(null)
    }
  }

  const runGraphPitch = async () => {
    if (!twin) return
    setPitchLoading(true)
    setPitchResult(null)
    setPitchError(null)
    try {
      const res = await runUniverseAgentPipeline({
        pipeline: ['universe', 'pitch'],
        input: {
          action: 'twin',
          entity_id: entityId,
          lead: twin.lead_row,
          company: twin.entity.name,
          website: twin.lead_row.sito ?? twin.entity.canonical_id,
        },
      })
      const pitchStep = res.results?.[1] as { data?: { subject?: string; body?: string } } | undefined
      if (pitchStep?.data) {
        setPitchResult(pitchStep.data)
      } else {
        setPitchError('Il pitch non ha prodotto output valido.')
      }
    } catch (e) {
      setPitchError(e instanceof Error ? e.message : 'Errore durante la generazione del pitch')
    } finally {
      setPitchLoading(false)
    }
  }

  if (loading && !twin) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
        Assemblaggio Digital Twin…
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</Card>
    )
  }

  if (!twin) return null

  const score = twin.opportunity_score
  const scoreTone =
    score >= 61 ? 'text-rose-700 bg-rose-50 border-rose-200' : score >= 31 ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-slate-600 bg-slate-50 border-slate-200'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-600">
            <Sparkles className="h-3.5 w-3.5" />
            Digital Twin
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Snapshot live del grafo — {twin.graph.nodes} nodi, {twin.graph.edges} relazioni
          </p>
        </div>
        <div className={cn('rounded-xl border px-4 py-2 text-center', scoreTone)}>
          <div className="text-2xl font-bold tabular-nums">{score}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide">Opportunity</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CONTEXT_ACTIONS.map(({ type, label, icon: Icon }) => {
          const active = activeContexts.has(type)
          return (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={active ? 'default' : 'outline'}
              className={cn('gap-1.5 text-xs', active && 'bg-violet-600 hover:bg-violet-700')}
              aria-pressed={active}
              disabled={contextBusy === type}
              onClick={() => void toggleContext(type)}
            >
              {contextBusy === type ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              {label}
            </Button>
          )
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs ml-auto"
          disabled={pitchLoading}
          onClick={() => void runGraphPitch()}
        >
          {pitchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
          Multi-agent: Pitch dal grafo
        </Button>
      </div>

      {pitchError ? (
        <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {pitchError}
        </Card>
      ) : null}

      {pitchResult?.subject ? (
        <Card className="border-violet-200 bg-violet-50/50 p-4 text-sm">
          <p className="font-semibold text-violet-900">{pitchResult.subject}</p>
          {pitchResult.body ? (
            <p className="mt-2 whitespace-pre-wrap text-slate-700 text-xs leading-relaxed">{pitchResult.body}</p>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {twin.tech_stack.length > 0 ? (
          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
              <Cpu className="h-3.5 w-3.5" /> Tech stack
            </p>
            <ExpandableList items={twin.tech_stack} initial={6} />
          </Card>
        ) : null}

        {twin.hiring.length > 0 ? (
          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
              <Briefcase className="h-3.5 w-3.5" /> Assunzioni
            </p>
            <ExpandableList items={twin.hiring} initial={5} />
          </Card>
        ) : null}

        {twin.people.length > 0 ? (
          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
              <Users className="h-3.5 w-3.5" /> Persone
            </p>
            <ExpandableList items={twin.people} initial={5} />
          </Card>
        ) : null}
      </div>

      {Object.keys(twin.attributes).length > 0 ? (
        <Card className="p-4">
          <p className="text-xs font-bold uppercase text-slate-500 mb-3">Attributi osservati</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(twin.attributes)
              .slice(0, 12)
              .map(([attr, snap]) => (
                <div key={attr} className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <dt className="text-[10px] font-bold uppercase text-slate-400">{labelObservation(attr)}</dt>
                  <dd className="text-sm font-semibold text-slate-900">{formatObservationValue(snap.value)}</dd>
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      {twin.events_recent.length > 0 ? (
        <Card className="p-4">
          <p className="text-xs font-bold uppercase text-slate-500 mb-2">Eventi recenti</p>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {twin.events_recent.slice(0, 8).map((ev) => (
              <li key={ev.id} className="flex justify-between gap-2">
                <span>{labelEvent(ev.event_type)}</span>
                <span className="text-xs text-slate-400 shrink-0">
                  {new Date(ev.occurred_at).toLocaleDateString('it-IT')}
                </span>
              </li>
            ))}
          </ul>
          {twin.events_recent.length > 8 ? (
            <p className="mt-2 text-xs text-slate-400">
              {twin.events_recent.length - 8} eventi aggiuntivi nella tab Eventi
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="border-t border-slate-100 pt-4">
        <UniverseLiveEventsFeed entityId={entityId} limit={8} />
      </div>

      <p className="text-[11px] text-slate-400 flex items-center gap-1">
        <Network className="h-3 w-3" />
        Assemblato {new Date(twin.assembled_at).toLocaleString('it-IT')}
        {' · '}
        <Link href="/dashboard/ecosistema/agenti" className="text-violet-600 hover:underline">
          Multi-Agent System
        </Link>
      </p>
    </div>
  )
}
