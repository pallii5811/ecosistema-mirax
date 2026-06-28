'use client'

import { useState } from 'react'
import {
  Calendar,
  Check,
  Edit3,
  Loader2,
  Mail,
  Sparkles,
  X,
} from 'lucide-react'
import {
  REPLY_INTENT_META,
  intentToOutreachStatus,
  type ReplyClassification,
  type ReplyIntent,
} from '@/lib/outreach-reply-classifier'
import { logOutreach } from '@/lib/outreach'

export type ClassificationRecord = {
  id: string
  intent: ReplyIntent
  suggested_action: string
  follow_up_at: string | null
  confidence: number
  rationale: string
  model: string
  reply_snippet: string
  lead_name?: string | null
  lead_website?: string | null
}

type Props = {
  record: ClassificationRecord
  onDecision: (decision: 'accepted' | 'modified' | 'ignored') => void
  onApplyOutcome?: () => void
}

export function ReplyClassificationCard({ record, onDecision, onApplyOutcome }: Props) {
  const [editing, setEditing] = useState(false)
  const [actionText, setActionText] = useState(record.suggested_action)
  const [submitting, setSubmitting] = useState(false)

  const meta = REPLY_INTENT_META[record.intent]

  const persistDecision = async (decision: 'accepted' | 'modified' | 'ignored', applyOutcome: boolean) => {
    setSubmitting(true)
    try {
      if (!record.id.startsWith('local-')) {
        await fetch('/api/outreach/classify-reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'decide',
            classificationId: record.id,
            userDecision: decision,
            modifiedAction: decision === 'modified' ? actionText : undefined,
          }),
        })
      }

      if (applyOutcome && decision !== 'ignored') {
        await logOutreach({
          website: record.lead_website,
          name: record.lead_name,
          channel: 'email',
          status: intentToOutreachStatus(record.intent),
          message: `[Risposta classificata: ${record.intent}] ${record.reply_snippet.slice(0, 200)}`,
          rationale: actionText,
        })
        onApplyOutcome?.()
      }

      onDecision(decision)
    } finally {
      setSubmitting(false)
    }
  }

  const followUpLabel = record.follow_up_at
    ? new Date(record.follow_up_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/80 to-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <Mail className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Risposta ricevuta
            </div>
            {record.lead_name ? (
              <div className="text-xs text-slate-500">{record.lead_name}</div>
            ) : null}
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${meta.tone}`}>
          {meta.label}
        </span>
      </div>

      <blockquote className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 italic line-clamp-4">
        &ldquo;{record.reply_snippet}&rdquo;
      </blockquote>

      <p className="text-xs text-slate-500 mb-3">{record.rationale}</p>

      {editing ? (
        <textarea
          value={actionText}
          onChange={(e) => setActionText(e.target.value)}
          rows={3}
          className="w-full mb-3 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-300"
        />
      ) : (
        <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Azione suggerita</p>
          <p className="text-sm text-slate-800">{actionText}</p>
        </div>
      )}

      {followUpLabel ? (
        <p className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500">
          <Calendar className="h-3.5 w-3.5" /> Follow-up suggerito: {followUpLabel}
        </p>
      ) : null}

      <p className="text-[10px] text-slate-400 mb-3">
        Confidenza {record.confidence}% · {record.model} · Nessun invio automatico
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() => persistDecision('accepted', true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Accetta suggerimento
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            if (editing) {
              void persistDecision('modified', true)
              setEditing(false)
            } else {
              setEditing(true)
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2"
        >
          <Edit3 className="h-3.5 w-3.5" />
          {editing ? 'Salva modifica' : 'Modifica'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => persistDecision('ignored', false)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 text-xs font-semibold px-3 py-2"
        >
          <X className="h-3.5 w-3.5" /> Ignora
        </button>
      </div>
    </div>
  )
}

type PanelProps = {
  defaultLeadName?: string
  defaultLeadWebsite?: string
  initialSnippet?: string
  onOutcomeLogged?: () => void
}

export function ReplyClassificationPanel({
  defaultLeadName = '',
  defaultLeadWebsite = '',
  initialSnippet = '',
  onOutcomeLogged,
}: PanelProps) {
  const [snippet, setSnippet] = useState(initialSnippet)
  const [leadName, setLeadName] = useState(defaultLeadName)
  const [leadWebsite, setLeadWebsite] = useState(defaultLeadWebsite)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<ClassificationRecord | null>(null)

  const classify = async () => {
    const text = snippet.trim()
    if (text.length < 5) {
      setError('Incolla almeno 5 caratteri della risposta.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/outreach/classify-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'classify',
          replySnippet: text,
          leadName: leadName.trim() || undefined,
          leadWebsite: leadWebsite.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Classificazione fallita')
      }
      const c = data.classification as ReplyClassification
      setActive({
        id: data.id || `local-${Date.now()}`,
        intent: c.intent,
        suggested_action: c.suggested_action,
        follow_up_at: c.follow_up_at,
        confidence: c.confidence,
        rationale: c.rationale,
        model: c.model,
        reply_snippet: text,
        lead_name: leadName.trim() || null,
        lead_website: leadWebsite.trim() || null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
    } finally {
      setLoading(false)
    }
  }

  if (active) {
    return (
      <ReplyClassificationCard
        record={active}
        onDecision={() => {
          setActive(null)
          setSnippet('')
        }}
        onApplyOutcome={onOutcomeLogged}
      />
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <h3 className="text-sm font-bold text-slate-900">AI SDR — Classifica risposta</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Incolla la risposta email ricevuta. MIRAX suggerisce l&apos;azione — tu decidi (nessun invio automatico).
      </p>

      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <input
          type="text"
          placeholder="Nome lead (opz.)"
          value={leadName}
          onChange={(e) => setLeadName(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
        <input
          type="text"
          placeholder="Sito web (opz.)"
          value={leadWebsite}
          onChange={(e) => setLeadWebsite(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
      </div>

      <textarea
        value={snippet}
        onChange={(e) => setSnippet(e.target.value)}
        rows={4}
        placeholder="Es: Grazie per l'email, mi interessa saperne di più. Possiamo sentirci giovedì?"
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-300 mb-3"
      />

      {error ? <p className="text-xs text-rose-600 mb-2">{error}</p> : null}

      <button
        type="button"
        onClick={classify}
        disabled={loading || snippet.trim().length < 5}
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Analizza risposta
      </button>
    </div>
  )
}

export default ReplyClassificationPanel
