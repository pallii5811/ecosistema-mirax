'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Sparkles,
  SkipForward,
  Tag,
  Target,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { OutreachLauncher } from '@/components/OutreachLauncher'
import {
  buildCampaignPlan,
  daysSince,
  OUTCOME_META,
  PRIORITY_META,
  RECOMMENDED_CHANNEL_LABEL,
  type CampaignStep,
  type Outcome,
  type OutreachMode,
} from '@/lib/outreach'

export type CampaignLead = {
  id: string
  name: string | null
  website: string | null
  email: string | null
  phone: string | null
  city: string | null
  category: string | null
  score: number | null
  raw?: Record<string, unknown> | null
}

type Props = {
  leads: CampaignLead[]
  mode: OutreachMode
  statusEnabled: boolean
  leadProblems: (lead: CampaignLead) => string[]
  getLastContact: (lead: CampaignLead) => string | null
  getOutcome: (lead: CampaignLead) => string | null
  isContacted: (lead: CampaignLead) => boolean
  recordOutcome: (lead: CampaignLead, outcome: Outcome) => void
  onLogged: () => void
}

function OutcomeButtons({
  lead,
  current,
  onPick,
}: {
  lead: CampaignLead
  current: string | null
  onPick: (lead: CampaignLead, outcome: Outcome) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-slate-400">Esito:</span>
      {(Object.keys(OUTCOME_META) as Outcome[]).map((key) => {
        const active = current === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(lead, key)}
            aria-pressed={active}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              active ? OUTCOME_META[key].active : OUTCOME_META[key].idle
            }`}
          >
            {OUTCOME_META[key].label}
          </button>
        )
      })}
    </div>
  )
}

function LeadLauncher({
  lead,
  mode,
  problems,
  lastContactedAt,
  onLogged,
  variant = 'primary',
  label,
}: {
  lead: CampaignLead
  mode: OutreachMode
  problems: string[]
  lastContactedAt: string | null
  onLogged: () => void
  variant?: 'primary' | 'dark'
  label?: string
}) {
  return (
    <OutreachLauncher
      nome={lead.name || ''}
      citta={lead.city || ''}
      categoria={lead.category || ''}
      sito={lead.website || ''}
      email={lead.email || ''}
      telefono={lead.phone || ''}
      leadId={lead.id}
      defaultMode={mode}
      problems={problems}
      lastContactedAt={lastContactedAt}
      onLogged={onLogged}
      variant={variant}
      label={label}
    />
  )
}

export function CampaignAgent({
  leads,
  mode,
  statusEnabled,
  leadProblems,
  getLastContact,
  getOutcome,
  isContacted,
  recordOutcome,
  onLogged,
}: Props) {
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)

  const plan = useMemo(
    () =>
      buildCampaignPlan(
        leads.map((l) => ({ ...l, problemsCount: leadProblems(l).length })),
        (l) => ({
          contacted: isContacted(l),
          lastDays: daysSince(getLastContact(l)),
          outcome: getOutcome(l),
        })
      ),
    [leads, leadProblems, isContacted, getLastContact, getOutcome]
  )

  const activeSteps = useMemo(() => plan.filter((s) => !s.excluded), [plan])
  const excludedCount = plan.length - activeSteps.length

  const counts = useMemo(() => {
    let high = 0
    let medium = 0
    let low = 0
    for (const s of activeSteps) {
      if (s.priority === 'high') high += 1
      else if (s.priority === 'medium') medium += 1
      else low += 1
    }
    return { high, medium, low }
  }, [activeSteps])

  // Esc + scroll lock for focus mode.
  useEffect(() => {
    if (!focusOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [focusOpen])

  const startFocus = () => {
    setFocusIndex(0)
    setFocusOpen(true)
  }

  if (activeSteps.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <Sparkles className="h-8 w-8 text-violet-400" />
        <div className="text-sm font-medium text-slate-700">
          {excludedCount > 0 ? 'Tutti i lead sono stati gestiti o esclusi' : 'Nessun lead da pianificare'}
        </div>
        {excludedCount > 0 && (
          <p className="text-xs text-slate-400">{excludedCount} esclusi perché &quot;non interessati&quot;.</p>
        )}
      </Card>
    )
  }

  const renderStep = (step: CampaignStep<CampaignLead & { problemsCount?: number }>) => {
    const meta = PRIORITY_META[step.priority]
    return (
      <div className="flex items-start gap-2">
        <span className={`mt-1 inline-flex h-2.5 w-2.5 flex-shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{step.lead.name || 'Senza nome'}</span>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
              Priorità {meta.label}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              <Target className="h-3 w-3" /> {RECOMMENDED_CHANNEL_LABEL[step.channel]}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
            {step.lead.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {step.lead.city}
              </span>
            )}
            {step.lead.category && (
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3 w-3" /> {step.lead.category}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{step.reasons.join(' · ')}</p>
        </div>
      </div>
    )
  }

  const focusStep = activeSteps[Math.min(focusIndex, activeSteps.length - 1)]

  return (
    <>
      {/* Sintesi dell'agente */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Piano dell&apos;agente</div>
              <p className="mt-0.5 max-w-xl text-xs text-slate-500">
                Ho analizzato {plan.length} lead e li ho ordinati per priorità di contatto, scegliendo il canale
                migliore e spiegando il perché. Approva e contatta, oppure avvia la modalità Focus.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Alta {counts.high}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Media {counts.medium}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Bassa {counts.low}
                </span>
                {excludedCount > 0 && <span className="text-slate-400">· {excludedCount} esclusi (non interessati)</span>}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={startFocus}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-violet-700"
          >
            <Sparkles className="h-4 w-4" /> Avvia Focus
          </button>
        </div>
      </Card>

      {/* Piano ordinato */}
      <div className="space-y-2">
        {activeSteps.map((step) => {
          const contacted = isContacted(step.lead)
          const outcome = getOutcome(step.lead)
          return (
            <Card key={step.lead.id} className="p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">{renderStep(step)}</div>
                <LeadLauncher
                  lead={step.lead}
                  mode={mode}
                  problems={leadProblems(step.lead)}
                  lastContactedAt={getLastContact(step.lead)}
                  onLogged={onLogged}
                  variant={contacted ? 'dark' : 'primary'}
                  label={contacted ? 'Ricontatta' : 'Contatta'}
                />
              </div>
              {contacted && statusEnabled && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <OutcomeButtons lead={step.lead} current={outcome} onPick={recordOutcome} />
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Modalità Focus */}
      {focusOpen && focusStep && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setFocusOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Modalità Focus"
            className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="h-4 w-4 text-violet-600" /> Focus · lead {focusIndex + 1} di {activeSteps.length}
              </div>
              <button
                type="button"
                onClick={() => setFocusOpen(false)}
                aria-label="Chiudi"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="h-1 w-full bg-slate-100">
              <div
                className="h-full bg-violet-500 transition-all"
                style={{ width: `${((focusIndex + 1) / activeSteps.length) * 100}%` }}
              />
            </div>

            <div className="px-5 py-4">
              {(() => {
                const meta = PRIORITY_META[focusStep.priority]
                const contacted = isContacted(focusStep.lead)
                const outcome = getOutcome(focusStep.lead)
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">{focusStep.lead.name || 'Senza nome'}</h3>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.badge}`}>
                        Priorità {meta.label}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      {focusStep.lead.city && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {focusStep.lead.city}
                        </span>
                      )}
                      {focusStep.lead.category && (
                        <span className="inline-flex items-center gap-1">
                          <Tag className="h-3 w-3" /> {focusStep.lead.category}
                        </span>
                      )}
                      {typeof focusStep.lead.score === 'number' && <span>Score {focusStep.lead.score}</span>}
                    </div>

                    <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700">
                        <Target className="h-3.5 w-3.5" /> Canale consigliato: {RECOMMENDED_CHANNEL_LABEL[focusStep.channel]}
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {focusStep.reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                            <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-violet-400" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-4">
                      <LeadLauncher
                        lead={focusStep.lead}
                        mode={mode}
                        problems={leadProblems(focusStep.lead)}
                        lastContactedAt={getLastContact(focusStep.lead)}
                        onLogged={onLogged}
                        variant={contacted ? 'dark' : 'primary'}
                        label={contacted ? 'Ricontatta' : 'Contatta ora'}
                      />
                    </div>

                    {contacted && statusEnabled && (
                      <div className="mt-4 border-t border-slate-100 pt-3">
                        <OutcomeButtons lead={focusStep.lead} current={outcome} onPick={recordOutcome} />
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setFocusIndex((i) => Math.max(0, i - 1))}
                disabled={focusIndex === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Indietro
              </button>
              <div className="flex items-center gap-2">
                {focusIndex < activeSteps.length - 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setFocusIndex((i) => Math.min(activeSteps.length - 1, i + 1))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50"
                    >
                      <SkipForward className="h-4 w-4" /> Salta
                    </button>
                    <button
                      type="button"
                      onClick={() => setFocusIndex((i) => Math.min(activeSteps.length - 1, i + 1))}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
                    >
                      Avanti <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFocusOpen(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                  >
                    Fine campagna
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default CampaignAgent
