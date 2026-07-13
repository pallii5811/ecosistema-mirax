'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Send,
  Loader2,
  RefreshCw,
  Mail,
  Clock,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  Ban,
  Trash2,
  AlertTriangle,
  Calendar,
  Inbox,
} from 'lucide-react'
import { useToast } from '@/components/ToastProvider'

type NextScheduled = { scheduled_at: string; step_index: number; subject: string }

type Run = {
  id: string
  sequence_id: string | null
  sequence_name: string
  recipient_email: string
  recipient_name: string | null
  sender_email: string
  sender_name: string | null
  status: 'active' | 'paused' | 'completed' | 'cancelled' | string
  steps_total: number
  steps_sent: number
  created_at: string
  completed_at: string | null
  next_scheduled: NextScheduled | null
}

type ScheduledEmail = {
  id: string
  step_index: number
  subject: string
  body: string
  scheduled_at: string
  status: 'pending' | 'sent' | 'failed' | 'cancelled' | string
  resend_id: string | null
  error_message: string | null
  sent_at: string | null
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active: { label: 'Attiva', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  paused: { label: 'In pausa', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  completed: { label: 'Completata', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  cancelled: { label: 'Annullata', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}

function relativeFuture(iso: string): string {
  const now = Date.now()
  const t = new Date(iso).getTime()
  const diff = t - now
  if (diff <= 0) return 'in elaborazione'
  const days = Math.floor(diff / 86_400_000)
  if (days >= 1) return `tra ${days} giorn${days === 1 ? 'o' : 'i'}`
  const hours = Math.floor(diff / 3_600_000)
  if (hours >= 1) return `tra ${hours} or${hours === 1 ? 'a' : 'e'}`
  const mins = Math.max(1, Math.floor(diff / 60_000))
  return `tra ${mins} min`
}

export default function CampaignsPage() {
  const { success: toastSuccess, error: toastError } = useToast()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tableMissing, setTableMissing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'completed' | 'cancelled'>('all')

  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const [openRunEmails, setOpenRunEmails] = useState<ScheduledEmail[]>([])
  const [openRunLoading, setOpenRunLoading] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = filter === 'all' ? '/api/sequences/runs' : `/api/sequences/runs?status=${filter}`
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (data?.tableMissing) {
        setTableMissing(true)
        setRuns([])
      } else {
        setTableMissing(false)
        setRuns(Array.isArray(data?.runs) ? data.runs : [])
      }
      if (data?.error) setError(data.error)
    } catch (e: any) {
      setError(e?.message || 'Errore di rete')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const openRun = useCallback(async (runId: string) => {
    if (openRunId === runId) {
      setOpenRunId(null)
      setOpenRunEmails([])
      return
    }
    setOpenRunId(runId)
    setOpenRunEmails([])
    setOpenRunLoading(true)
    try {
      const res = await fetch(`/api/sequences/runs/${runId}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      setOpenRunEmails(Array.isArray(data?.emails) ? data.emails : [])
    } catch {
      /* */
    } finally {
      setOpenRunLoading(false)
    }
  }, [openRunId])

  const callAction = async (runId: string, action: 'pause' | 'resume' | 'cancel') => {
    setActionLoadingId(runId)
    try {
      const res = await fetch(`/api/sequences/runs/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => null)
      if (!data?.ok) {
        toastError(data?.error || 'Errore azione', 'Campagne')
      } else {
        // Aggiorna in place
        setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, ...data.run } : r)))
        toastSuccess('Campagna aggiornata', 'Campagne')
      }
    } catch (e: any) {
      toastError(e?.message || 'Errore di rete', 'Campagne')
    } finally {
      setActionLoadingId(null)
    }
  }

  const deleteRun = async (runId: string) => {
    if (!confirm('Eliminare definitivamente questa campagna e tutte le email rimaste?')) return
    setActionLoadingId(runId)
    try {
      const res = await fetch(`/api/sequences/runs/${runId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!data?.ok) {
        toastError(data?.error || 'Errore eliminazione', 'Campagne')
        return
      }
      setRuns((prev) => prev.filter((r) => r.id !== runId))
      toastSuccess('Campagna eliminata', 'Campagne')
      if (openRunId === runId) {
        setOpenRunId(null)
        setOpenRunEmails([])
      }
    } catch (e: any) {
      toastError(e?.message || 'Errore di rete', 'Campagne')
    } finally {
      setActionLoadingId(null)
    }
  }

  const counts = {
    active: runs.filter((r) => r.status === 'active').length,
    paused: runs.filter((r) => r.status === 'paused').length,
    completed: runs.filter((r) => r.status === 'completed').length,
    cancelled: runs.filter((r) => r.status === 'cancelled').length,
    total: runs.length,
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/sequences"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} /> Torna alle sequenze
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Campagne attive</h1>
            <p className="mt-1 text-sm text-slate-500">Monitora gli invii in tempo reale. Pause, riprendi o annulla con un click.</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
            Aggiorna
          </button>
        </div>
      </div>

      {tableMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
          <div>
            <strong>Persistenza campagne non attiva.</strong> Esegui la migration SQL indicata in{' '}
            <code className="text-xs bg-amber-100 px-1 rounded">src/app/api/sequences/[id]/launch/route.ts</code> nel SQL Editor di Supabase.
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm">{error}</div>
      )}

      {/* Filtro stato */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: 'all', label: 'Tutte', count: counts.total },
          { id: 'active', label: 'Attive', count: counts.active },
          { id: 'paused', label: 'In pausa', count: counts.paused },
          { id: 'completed', label: 'Completate', count: counts.completed },
          { id: 'cancelled', label: 'Annullate', count: counts.cancelled },
        ] as const).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id as any)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
              filter === f.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label} <span className="opacity-70 ml-1">{f.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" strokeWidth={1.75} />
        </div>
      ) : runs.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
          <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" strokeWidth={1.75} />
          <h3 className="text-base font-semibold text-slate-900">
            {tableMissing ? 'Persistenza non attiva' : 'Nessuna campagna ancora lanciata'}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {tableMissing
              ? 'Applica la migration SQL e ricarica.'
              : 'Vai alle sequenze, salva una sequenza e clicca Lancia campagna per iniziare.'}
          </p>
          {!tableMissing && (
            <Link
              href="/dashboard/sequences"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
            >
              <Send className="w-4 h-4" strokeWidth={1.75} /> Vai alle Sequenze
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            const style = STATUS_STYLE[run.status] || STATUS_STYLE.cancelled
            const progress = run.steps_total > 0 ? Math.round((run.steps_sent / run.steps_total) * 100) : 0
            const isOpen = openRunId === run.id

            return (
              <div
                key={run.id}
                className="bg-white rounded-lg border border-slate-200 overflow-hidden hover:border-slate-300 transition-colors"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900 truncate">{run.sequence_name}</h3>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${style.cls}`}>
                          {style.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-3">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" strokeWidth={1.75} /> {run.recipient_email}
                        </span>
                        <span className="text-slate-400">
                          da {run.sender_name ? `${run.sender_name} ` : ''}&lt;{run.sender_email}&gt;
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {run.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => callAction(run.id, 'pause')}
                          disabled={actionLoadingId === run.id}
                          className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                          title="Metti in pausa"
                        >
                          <Pause className="w-3 h-3" strokeWidth={1.75} /> Pausa
                        </button>
                      )}
                      {run.status === 'paused' && (
                        <button
                          type="button"
                          onClick={() => callAction(run.id, 'resume')}
                          disabled={actionLoadingId === run.id}
                          className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                          title="Riprendi"
                        >
                          <Play className="w-3 h-3" strokeWidth={1.75} /> Riprendi
                        </button>
                      )}
                      {(run.status === 'active' || run.status === 'paused') && (
                        <button
                          type="button"
                          onClick={() => callAction(run.id, 'cancel')}
                          disabled={actionLoadingId === run.id}
                          className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                          title="Annulla"
                        >
                          <Ban className="w-3 h-3" strokeWidth={1.75} /> Annulla
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteRun(run.id)}
                        disabled={actionLoadingId === run.id}
                        className="text-xs p-1.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Elimina"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[160px]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-slate-500">Progresso</span>
                        <span className="text-[11px] font-semibold text-slate-700 tabular-nums">
                          {run.steps_sent}/{run.steps_total} ({progress}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            run.status === 'completed'
                              ? 'bg-slate-900'
                              : run.status === 'cancelled'
                                ? 'bg-slate-400'
                                : run.status === 'paused'
                                  ? 'bg-amber-500'
                                  : 'bg-slate-900'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    {run.next_scheduled && run.status === 'active' && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-md">
                        <Calendar className="w-3 h-3 text-slate-400" strokeWidth={1.75} />
                        Prossima: Email {run.next_scheduled.step_index} {relativeFuture(run.next_scheduled.scheduled_at)}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-slate-400">
                      Lanciata {new Date(run.created_at).toLocaleString('it-IT')}
                    </span>
                    <button
                      type="button"
                      onClick={() => openRun(run.id)}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                    >
                      {isOpen ? 'Nascondi dettagli' : 'Mostra dettagli'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-5">
                    {openRunLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Caricamento email…
                      </div>
                    ) : openRunEmails.length === 0 ? (
                      <p className="text-sm text-slate-400">Nessuna email schedulata.</p>
                    ) : (
                      <ul className="space-y-2">
                        {openRunEmails.map((email) => {
                          const statusIcon =
                            email.status === 'sent' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" strokeWidth={1.75} />
                            ) : email.status === 'failed' ? (
                              <XCircle className="w-3.5 h-3.5 text-red-500" strokeWidth={1.75} />
                            ) : email.status === 'cancelled' ? (
                              <Ban className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.75} />
                            )
                          return (
                            <li key={email.id} className="bg-white rounded-lg border border-slate-200 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600 tabular-nums">
                                    {email.step_index}
                                  </span>
                                  <span className="text-sm font-medium text-slate-900 truncate">{email.subject}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 flex-shrink-0">
                                  {statusIcon}
                                  <span>
                                    {email.status === 'sent'
                                      ? `Inviata ${email.sent_at ? new Date(email.sent_at).toLocaleString('it-IT') : ''}`
                                      : email.status === 'failed'
                                        ? `Fallita`
                                        : email.status === 'cancelled'
                                          ? 'Annullata'
                                          : `Schedulata ${new Date(email.scheduled_at).toLocaleString('it-IT')}`}
                                  </span>
                                </div>
                              </div>
                              {email.status === 'failed' && email.error_message && (
                                <div className="mt-2 text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">
                                  {email.error_message}
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
