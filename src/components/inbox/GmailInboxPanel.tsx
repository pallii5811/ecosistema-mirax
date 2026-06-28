'use client'

import { useCallback, useEffect, useState } from 'react'
import { Inbox, Loader2, LogOut, Mail, Sparkles } from 'lucide-react'
import { ReplyClassificationPanel } from '@/components/outreach/ReplyClassificationPanel'

type GmailMsg = {
  id: string
  snippet: string
  from: string
  subject: string
}

export function GmailInboxPanel({ onOutcomeLogged }: { onOutcomeLogged?: () => void }) {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [messages, setMessages] = useState<GmailMsg[]>([])
  const [selected, setSelected] = useState<GmailMsg | null>(null)
  const [selectedBody, setSelectedBody] = useState<string | null>(null)
  const [fetchingBody, setFetchingBody] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inbox/gmail/messages', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      setConfigured(data.configured !== false)
      setConnected(Boolean(data.connected))
      setEmail(data.email || null)
      setMessages(Array.isArray(data.messages) ? data.messages : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openForClassification = async (msg: GmailMsg) => {
    setSelected(msg)
    setFetchingBody(true)
    try {
      const res = await fetch('/api/inbox/gmail/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msg.id }),
      })
      const data = await res.json().catch(() => ({}))
      setSelectedBody(typeof data.body === 'string' && data.body.trim() ? data.body : msg.snippet)
    } catch {
      setSelectedBody(msg.snippet)
    } finally {
      setFetchingBody(false)
    }
  }

  const disconnect = async () => {
    await fetch('/api/inbox/gmail/messages', { method: 'DELETE' })
    setConnected(false)
    setMessages([])
    setSelected(null)
    setSelectedBody(null)
  }

  if (selected && selectedBody) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setSelected(null)
            setSelectedBody(null)
          }}
          className="text-xs text-violet-600 hover:underline"
        >
          ← Torna alla inbox
        </button>
        <ReplyClassificationPanel
          defaultLeadName={selected.from}
          initialSnippet={selectedBody}
          onOutcomeLogged={onOutcomeLogged}
        />
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-bold text-slate-900">Inbox Gmail (sola lettura)</h3>
        </div>
        {connected ? (
          <button type="button" onClick={disconnect} className="text-xs text-slate-500 hover:text-rose-600 inline-flex items-center gap-1">
            <LogOut className="h-3 w-3" /> Disconnetti
          </button>
        ) : null}
      </div>

      {!configured ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          Configura <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_ID</code> e{' '}
          <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> per abilitare Gmail OAuth.
          Fino ad allora incolla le risposte manualmente nel pannello AI SDR sotto.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
        </div>
      ) : !connected ? (
        <div className="text-center py-4">
          <p className="text-xs text-slate-500 mb-3">Collega Gmail per importare risposte e classificarle con AI SDR (HITL).</p>
          <a
            href="/api/inbox/gmail/connect"
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold px-4 py-2.5"
          >
            <Mail className="h-4 w-4" /> Connetti Gmail
          </a>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">{email}</p>
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {messages.length === 0 ? (
              <li className="text-xs text-slate-400 py-2">Nessun messaggio recente in inbox.</li>
            ) : (
              messages.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={fetchingBody}
                    onClick={() => openForClassification(m)}
                    className="w-full text-left rounded-lg border border-slate-100 hover:border-violet-200 hover:bg-violet-50/50 px-3 py-2 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-800 truncate">{m.subject || '(senza oggetto)'}</div>
                    <div className="text-[10px] text-slate-400 truncate">{m.from}</div>
                    <div className="text-[11px] text-slate-600 line-clamp-2 mt-0.5">{m.snippet}</div>
                  </button>
                </li>
              ))
            )}
          </ul>
          <p className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Clicca un messaggio → classificazione AI (nessun invio automatico)
          </p>
        </>
      )}
    </div>
  )
}

export default GmailInboxPanel
