"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Database,
  Filter,
  Loader2,
  MapPin,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
  Target,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { OutreachLauncher } from '@/components/OutreachLauncher'
import { CampaignAgent } from '@/components/CampaignAgent'
import {
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  DAILY_SOFT_LIMIT,
  OUTCOME_META,
  RECENT_CONTACT_DAYS,
  RESPONSE_OUTCOMES,
  computeFunnel,
  daysSince,
  deriveOutreach,
  leadMatchKeys,
  logOutreach,
  type Outcome,
  type OutreachMode,
  type OutreachStatusItem,
} from '@/lib/outreach'

type DomainList = {
  id: string
  name: string
  description: string | null
  created_at: string
  leadsCount?: number
}

type Lead = {
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

type StatusItem = OutreachStatusItem

function leadProblems(lead: Lead): string[] {
  const problems: string[] = []
  if (!lead.website) problems.push('Sito web assente')
  if (!lead.email) problems.push('Email non presente')
  const raw = lead.raw || {}
  const hasGoogleAds = (raw as Record<string, unknown>)['has_google_ads']
  if (hasGoogleAds === false && lead.website) problems.push('Nessuna campagna Google Ads')
  return problems
}

export default function OutreachConsolePage() {
  const [lists, setLists] = useState<DomainList[]>([])
  const [listsLoading, setListsLoading] = useState(true)
  const [listsError, setListsError] = useState<string | null>(null)

  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)

  const [statusItems, setStatusItems] = useState<StatusItem[]>([])
  const [statusEnabled, setStatusEnabled] = useState(true)
  const [todayCount, setTodayCount] = useState(0)
  const [channelCounts, setChannelCounts] = useState<Record<string, number>>({})
  const [modeCounts, setModeCounts] = useState<Record<string, number>>({})
  const [daily, setDaily] = useState<{ date: string; count: number }[]>([])

  const [mode, setMode] = useState<OutreachMode>('sell_service')
  const [onlyTodo, setOnlyTodo] = useState(false)
  const [viewMode, setViewMode] = useState<'queue' | 'agent'>('queue')

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/status', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!data) return
      setStatusEnabled(data.enabled !== false)
      setStatusItems(Array.isArray(data.items) ? data.items : [])
      setTodayCount(typeof data.todayCount === 'number' ? data.todayCount : 0)
      setChannelCounts(data.channelCounts && typeof data.channelCounts === 'object' ? data.channelCounts : {})
      setModeCounts(data.modeCounts && typeof data.modeCounts === 'object' ? data.modeCounts : {})
      setDaily(Array.isArray(data.daily) ? data.daily : [])
    } catch {
      /* best-effort */
    }
  }, [])

  useEffect(() => {
    const run = async () => {
      setListsLoading(true)
      setListsError(null)
      try {
        const res = await fetch('/api/lists/stats', { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { lists?: DomainList[]; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'Impossibile caricare le liste.')
        setLists(Array.isArray(data?.lists) ? data!.lists! : [])
      } catch (e) {
        setListsError(e instanceof Error ? e.message : 'Errore durante il caricamento.')
      } finally {
        setListsLoading(false)
      }
    }
    run()
    loadStatus()
  }, [loadStatus])

  const selectList = useCallback(async (listId: string) => {
    setSelectedListId(listId)
    setLeadsLoading(true)
    setLeads([])
    try {
      const res = await fetch(`/api/lists/${listId}/leads`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      setLeads(Array.isArray(data?.leads) ? data.leads : [])
    } catch {
      setLeads([])
    } finally {
      setLeadsLoading(false)
    }
  }, [])

  // Derive, from the raw event log (newest-first), three per-lead views:
  //  - sent keys (any send event) → "contattato"
  //  - last send timestamp → anti-duplicate guardrail
  //  - latest outcome → closed-loop funnel
  // We index by BOTH website and name keys so a lead matches if either was logged.
  const derived = useMemo(() => deriveOutreach(statusItems), [statusItems])

  const leadKeys = useCallback((lead: Lead): string[] => leadMatchKeys(lead.website, lead.name), [])

  const isContacted = useCallback(
    (lead: Lead) => leadKeys(lead).some((k) => derived.sentKeys.has(k)),
    [leadKeys, derived]
  )

  const getLastContact = useCallback(
    (lead: Lead): string | null => {
      for (const k of leadKeys(lead)) {
        const v = derived.lastSend.get(k)
        if (v) return v
      }
      return null
    },
    [leadKeys, derived]
  )

  const getOutcome = useCallback(
    (lead: Lead): string | null => {
      for (const k of leadKeys(lead)) {
        const v = derived.latestOutcome.get(k)
        if (v) return v
      }
      return null
    },
    [leadKeys, derived]
  )

  // Global funnel computed from distinct leads (shared logic).
  const funnel = useMemo(() => computeFunnel(statusItems), [statusItems])

  // Funnel restricted to the currently selected list's leads.
  const listFunnel = useMemo(() => {
    let contacted = 0
    let responses = 0
    let interested = 0
    let notInterested = 0
    for (const lead of leads) {
      if (!isContacted(lead)) continue
      contacted += 1
      const o = getOutcome(lead)
      if (o && RESPONSE_OUTCOMES.has(o)) responses += 1
      if (o === 'interested') interested += 1
      if (o === 'not_interested') notInterested += 1
    }
    return {
      contacted,
      responses,
      interested,
      notInterested,
      responseRate: contacted > 0 ? Math.round((responses / contacted) * 100) : 0,
      interestRate: contacted > 0 ? Math.round((interested / contacted) * 100) : 0,
    }
  }, [leads, isContacted, getOutcome])

  // Persist an outcome for a lead (best-effort) then refresh.
  const recordOutcome = useCallback(
    async (lead: Lead, status: Outcome) => {
      await logOutreach({
        leadId: lead.id,
        website: lead.website,
        name: lead.name,
        channel: 'other',
        status,
      })
      loadStatus()
    },
    [loadStatus]
  )

  const recentInList = useMemo(
    () =>
      leads.filter((l) => {
        const d = daysSince(getLastContact(l))
        return d !== null && d <= RECENT_CONTACT_DAYS
      }).length,
    [leads, getLastContact]
  )

  const channelEntries = useMemo(() => {
    const entries = Object.entries(channelCounts).filter(([, n]) => n > 0)
    entries.sort((a, b) => b[1] - a[1])
    const total = entries.reduce((sum, [, n]) => sum + n, 0)
    return { entries, total }
  }, [channelCounts])

  const maxDaily = useMemo(() => Math.max(1, ...daily.map((d) => d.count)), [daily])

  const alerts = useMemo(() => {
    const out: { tone: 'critical' | 'warn' | 'info'; text: string }[] = []
    if (todayCount >= DAILY_SOFT_LIMIT) {
      out.push({ tone: 'critical', text: `Limite giornaliero superato (${todayCount}/${DAILY_SOFT_LIMIT}). Rallenta per proteggere gli account.` })
    } else if (todayCount >= Math.floor(DAILY_SOFT_LIMIT * 0.8)) {
      out.push({ tone: 'warn', text: `Ti avvicini al limite giornaliero (${todayCount}/${DAILY_SOFT_LIMIT}).` })
    }
    if (selectedListId && recentInList > 0) {
      out.push({ tone: 'warn', text: `${recentInList} lead in questa lista già contattati negli ultimi ${RECENT_CONTACT_DAYS} giorni.` })
    }
    if (out.length === 0) {
      out.push({ tone: 'info', text: 'Nessuna anomalia rilevata. Tutto nei limiti operativi.' })
    }
    return out
  }, [todayCount, selectedListId, recentInList])

  const contactedInList = useMemo(() => leads.filter((l) => isContacted(l)).length, [leads, isContacted])
  const visibleLeads = useMemo(
    () => (onlyTodo ? leads.filter((l) => !isContacted(l)) : leads),
    [leads, onlyTodo, isContacted]
  )

  const selectedList = lists.find((l) => l.id === selectedListId) || null
  const overLimit = todayCount >= DAILY_SOFT_LIMIT
  // Contextual funnel: list-scoped when a list is open, global otherwise.
  const displayFunnel = selectedList ? listFunnel : funnel

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href="/dashboard" className="inline-flex items-center gap-1 hover:text-slate-800">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 text-violet-600">
          <Target className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">Centro Outreach</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Contatta i tuoi lead in serie</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Seleziona una lista, scorri la coda e contatta ogni lead sul canale giusto. MIRAX genera il messaggio,
          tu mantieni il controllo. Ogni invio viene tracciato per audit e monitoraggio.
        </p>
      </div>

      {!statusEnabled && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Database className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <div className="font-semibold">Tracciamento outreach non ancora attivo</div>
            <p className="mt-0.5 text-amber-700">
              Puoi già contattare i lead, ma per registrare lo storico esegui la migrazione{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">db/migrations/2026_06_22_outreach_log.sql</code>{' '}
              su Supabase.
            </p>
          </div>
        </div>
      )}

      {/* Funnel reale (closed-loop) — performance, non vanity metrics */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Funnel</span>
        <span
          className="inline-flex max-w-[60%] items-center gap-1.5 truncate rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-600"
          title={selectedList ? `Ambito: lista ${selectedList.name}` : 'Ambito: tutte le liste'}
        >
          <Target className="h-3 w-3 flex-shrink-0 text-violet-500" />
          <span className="truncate">{selectedList ? selectedList.name : 'Tutte le liste'}</span>
        </span>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Lead contattati</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{displayFunnel.contacted}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{todayCount} oggi (tutte le liste)</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Risposte</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-blue-600">{displayFunnel.responses}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{displayFunnel.responseRate}% tasso risposta</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Interessati</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{displayFunnel.interested}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{displayFunnel.interestRate}% tasso interesse</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Non interessati</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-rose-500">{displayFunnel.notInterested}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">da escludere dai follow-up</div>
        </Card>
      </div>

      {overLimit && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <div className="font-semibold">Hai superato {DAILY_SOFT_LIMIT} contatti oggi</div>
            <p className="mt-0.5 text-amber-700">
              Per proteggere i tuoi account (WhatsApp/Email) ti consigliamo di rallentare e riprendere domani.
            </p>
          </div>
        </div>
      )}

      {/* Governance & monitoraggio (Messaggio chiave 5 del manifesto) */}
      {statusEnabled && (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-slate-700">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-semibold uppercase tracking-wider">Guardrail attivi</span>
            </div>

            {/* Live: utilizzo del limite giornaliero */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <Clock className="h-3.5 w-3.5 text-slate-400" /> Limite giornaliero (anti-ban)
                </span>
                <span className={`font-semibold tabular-nums ${overLimit ? 'text-rose-600' : 'text-slate-700'}`}>
                  {todayCount}/{DAILY_SOFT_LIMIT}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${overLimit ? 'bg-rose-500' : todayCount >= DAILY_SOFT_LIMIT * 0.8 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, Math.round((todayCount / DAILY_SOFT_LIMIT) * 100))}%` }}
                />
              </div>
            </div>

            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                Anti-duplicato {RECENT_CONTACT_DAYS} giorni con conferma manuale al ricontatto
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                Human-in-the-loop: ogni invio è approvato dall&apos;operatore
              </li>
              <li className="flex items-start gap-2">
                <Database className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                Tracciate {statusItems.length} azioni · messaggio + motivazione AI
              </li>
            </ul>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-slate-700">
              <BarChart3 className="h-4 w-4 text-violet-600" />
              <span className="text-xs font-semibold uppercase tracking-wider">Andamento 7 giorni</span>
            </div>
            <div className="flex h-24 items-end justify-between gap-1">
              {daily.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.count}`}>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-violet-400"
                      style={{ height: `${Math.round((d.count / maxDaily) * 100)}%`, minHeight: d.count > 0 ? 4 : 0 }}
                    />
                  </div>
                  <span className="text-[9px] text-slate-400">{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
              <span>Contatti negli ultimi 7 giorni</span>
              <span className="font-semibold text-slate-600">{daily.reduce((s, d) => s + d.count, 0)}</span>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-slate-700">
              <Activity className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-semibold uppercase tracking-wider">Allerte predittive</span>
            </div>
            <ul className="space-y-2 text-xs">
              {alerts.map((a, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${
                    a.tone === 'critical'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : a.tone === 'warn'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {a.tone === 'info' ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  )}
                  {a.text}
                </li>
              ))}
            </ul>
            {channelEntries.total > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Canali (30 gg)
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  {channelEntries.entries.map(([ch, n]) => (
                    <div
                      key={ch}
                      className={CHANNEL_COLORS[ch] || 'bg-slate-400'}
                      style={{ width: `${(n / channelEntries.total) * 100}%` }}
                      title={`${CHANNEL_LABELS[ch] || ch}: ${n}`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  {channelEntries.entries.map(([ch, n]) => (
                    <span key={ch} className="inline-flex items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${CHANNEL_COLORS[ch] || 'bg-slate-400'}`} />
                      {CHANNEL_LABELS[ch] || ch} {n}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-violet-500" /> Promo {modeCounts.mirax_promo || 0}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Target className="h-3 w-3 text-slate-400" /> Vendita {modeCounts.sell_service || 0}
                  </span>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        {/* List selector */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Le tue liste</div>
            <button
              type="button"
              onClick={loadStatus}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"
              title="Aggiorna stato"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>

          {listsLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Carico…
            </div>
          ) : listsError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{listsError}</div>
          ) : lists.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Nessuna lista salvata. <Link href="/dashboard" className="text-violet-600 underline">Crea una ricerca</Link>.
            </div>
          ) : (
            <div className="space-y-1.5">
              {lists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => selectList(list.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selectedListId === list.id
                      ? 'border-violet-300 bg-violet-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="truncate text-sm font-medium text-slate-800">{list.name}</span>
                  <span className="ml-2 flex-shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                    {typeof list.leadsCount === 'number' ? list.leadsCount : '—'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Queue */}
        <div>
          {!selectedList ? (
            <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <Radar className="h-10 w-10 text-slate-300" />
              <div className="text-sm font-medium text-slate-600">Seleziona una lista per iniziare</div>
              <p className="max-w-sm text-xs text-slate-400">
                Ogni lead avrà un pulsante &quot;Contatta&quot; con messaggio generato e canali pronti all&apos;uso.
              </p>
            </Card>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{selectedList.name}</h2>
                  <p className="text-xs text-slate-500">
                    {leads.length} lead · {contactedInList} contattati · {Math.max(0, leads.length - contactedInList)} in coda
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setViewMode('queue')}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                        viewMode === 'queue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      Coda
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('agent')}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                        viewMode === 'agent' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      <Sparkles className="h-3 w-3" /> Agente
                    </button>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setMode('sell_service')}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                        mode === 'sell_service' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      Vendi servizio
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('mirax_promo')}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                        mode === 'mirax_promo' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      <Sparkles className="h-3 w-3" /> Promo
                    </button>
                  </div>
                  {viewMode === 'queue' && (
                    <button
                      type="button"
                      onClick={() => setOnlyTodo((v) => !v)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        onlyTodo ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <Filter className="h-3.5 w-3.5" /> Solo da contattare
                    </button>
                  )}
                </div>
              </div>

              {leadsLoading ? (
                <div className="flex items-center gap-2 p-8 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carico i lead…
                </div>
              ) : viewMode === 'agent' ? (
                <CampaignAgent
                  leads={leads}
                  mode={mode}
                  statusEnabled={statusEnabled}
                  leadProblems={leadProblems}
                  getLastContact={getLastContact}
                  getOutcome={getOutcome}
                  isContacted={isContacted}
                  recordOutcome={recordOutcome}
                  onLogged={loadStatus}
                />
              ) : visibleLeads.length === 0 ? (
                <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <div className="text-sm font-medium text-slate-700">
                    {onlyTodo ? 'Tutti i lead sono stati contattati' : 'Nessun lead in questa lista'}
                  </div>
                </Card>
              ) : (
                <div className="space-y-2">
                  {visibleLeads.map((lead) => {
                    const contacted = isContacted(lead)
                    const outcome = getOutcome(lead)
                    const lastDays = contacted ? daysSince(getLastContact(lead)) : null
                    return (
                      <Card key={lead.id} className="p-3.5">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-slate-900">
                                {lead.name || 'Senza nome'}
                              </span>
                              {contacted ? (
                                <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" /> Contattato
                                </span>
                              ) : (
                                <span className="inline-flex flex-shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                  Da contattare
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                              {lead.city && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3 w-3" /> {lead.city}
                                </span>
                              )}
                              {lead.category && (
                                <span className="inline-flex items-center gap-1">
                                  <Tag className="h-3 w-3" /> {lead.category}
                                </span>
                              )}
                              {typeof lead.score === 'number' && <span>Score {lead.score}</span>}
                              {lastDays !== null && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {lastDays === 0 ? 'contattato oggi' : `contattato ${lastDays} g fa`}
                                </span>
                              )}
                            </div>
                          </div>
                          <OutreachLauncher
                            nome={lead.name || ''}
                            citta={lead.city || ''}
                            categoria={lead.category || ''}
                            sito={lead.website || ''}
                            email={lead.email || ''}
                            telefono={lead.phone || ''}
                            leadId={lead.id}
                            defaultMode={mode}
                            problems={leadProblems(lead)}
                            lastContactedAt={getLastContact(lead)}
                            variant={contacted ? 'dark' : 'primary'}
                            label={contacted ? 'Ricontatta' : 'Contatta'}
                            onLogged={loadStatus}
                          />
                        </div>

                        {/* Esito (closed-loop): visibile solo dopo il contatto */}
                        {contacted && statusEnabled && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                            <span className="text-[11px] font-medium text-slate-400">Esito:</span>
                            {(Object.keys(OUTCOME_META) as Outcome[]).map((key) => {
                              const active = outcome === key
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => recordOutcome(lead, key)}
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
                        )}
                      </Card>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
