'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Send, Loader2, Copy, CheckCircle, Mail, Clock, ChevronDown, ChevronUp,
  Sparkles, RotateCcw, User, Building2, Palette, Globe, Wrench, ArrowLeft,
  Save, FolderOpen, Trash2, AlertTriangle, FileText, Rocket, X, ListChecks
} from 'lucide-react'
import Link from 'next/link'

type EmailStep = {
  step: number
  subject: string
  body: string
  waitDays: number
}

type SavedSequence = {
  id: string
  name: string
  company_name: string | null
  website: string | null
  service: string | null
  sender_name: string | null
  sender_company: string | null
  tone: string | null
  steps: EmailStep[]
  created_at: string
  updated_at: string
}

const TONES = [
  { value: 'professionale', label: 'Professionale' },
  { value: 'amichevole', label: 'Amichevole' },
  { value: 'diretto', label: 'Diretto / Urgente' },
  { value: 'consulenziale', label: 'Consulenziale' },
]

function EmailCard({ email, index, onEdit }: { email: EmailStep; index: number; onEdit: (idx: number, field: 'subject' | 'body', value: string) => void }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const copyEmail = () => {
    const text = `Oggetto: ${email.subject}\n\n${email.body}`
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }

  const dayLabel = email.waitDays === 0 ? 'Giorno 1 — Primo contatto' : `Giorno ${email.waitDays + 1} — +${email.waitDays} giorni`

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between p-4 hover:bg-slate-50/60 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-sm font-semibold text-slate-700 tabular-nums">
            {email.step}
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-slate-900">Email {email.step}</div>
            <div className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" strokeWidth={1.75} />{dayLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); copyEmail() }}
            className="text-xs px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 transition-colors">
            {copied ? <><CheckCircle className="w-3 h-3 text-emerald-500" /> Copiato</> : <><Copy className="w-3 h-3" /> Copia</>}
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wider">Oggetto</label>
            <input value={email.subject} onChange={(e) => onEdit(index, 'subject', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none bg-white transition-colors" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wider">Corpo Email</label>
            <textarea value={email.body} onChange={(e) => onEdit(index, 'body', e.target.value)} rows={6}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm leading-relaxed focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none bg-white resize-none transition-colors" />
          </div>
        </div>
      )}
    </div>
  )
}

function SequencesContent() {
  const searchParams = useSearchParams()
  const [companyName, setCompanyName] = useState('')
  const [website, setWebsite] = useState('')
  const [service, setService] = useState('')
  const [senderName, setSenderName] = useState('')
  const [senderCompany, setSenderCompany] = useState('')
  const [tone, setTone] = useState('professionale')
  const [steps, setSteps] = useState(4)
  const [sequence, setSequence] = useState<EmailStep[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allCopied, setAllCopied] = useState(false)

  // Persistence state
  const [saved, setSaved] = useState<SavedSequence[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [tableMissing, setTableMissing] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [savingName, setSavingName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [showSaveForm, setShowSaveForm] = useState(false)

  // Launch campaign state
  const [launchSeqId, setLaunchSeqId] = useState<string | null>(null)
  const [launchSeqName, setLaunchSeqName] = useState('')
  const [launchRecipientEmail, setLaunchRecipientEmail] = useState('')
  const [launchRecipientName, setLaunchRecipientName] = useState('')
  const [launchSenderEmail, setLaunchSenderEmail] = useState('')
  const [launchSenderName, setLaunchSenderName] = useState('')
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launchResult, setLaunchResult] = useState<{ runId: string; firstSent: boolean; pendingCount: number; firstError: string | null; resendConfigured: boolean } | null>(null)

  useEffect(() => {
    const n = searchParams.get('name')
    const w = searchParams.get('website')
    const s = searchParams.get('service')
    if (n) setCompanyName(n)
    if (w) setWebsite(w)
    if (s) setService(s)
  }, [searchParams])

  const loadSavedSequences = useCallback(async () => {
    setSavedLoading(true)
    try {
      const res = await fetch('/api/sequences', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (data?.tableMissing) {
        setTableMissing(true)
        setSaved([])
      } else {
        setTableMissing(false)
        setSaved(Array.isArray(data?.sequences) ? data.sequences : [])
      }
    } catch {
      /* silent */
    } finally {
      setSavedLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSavedSequences()
  }, [loadSavedSequences])

  const saveSequence = async () => {
    const name = savingName.trim() || companyName.trim() || 'Sequenza senza nome'
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch('/api/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentId,
          name,
          companyName,
          website,
          service,
          senderName,
          senderCompany,
          tone,
          steps: sequence,
        }),
      })
      const data = await res.json().catch(() => null)
      if (data?.tableMissing) {
        setTableMissing(true)
        setSaveError(
          'La tabella `sequences` non è ancora attiva. Applica la migration SQL dal supporto / README per abilitare il salvataggio.'
        )
        return
      }
      if (!data?.ok) {
        setSaveError(data?.error || 'Errore salvataggio')
        return
      }
      setSaveSuccess(true)
      setShowSaveForm(false)
      if (data?.sequence?.id) setCurrentId(data.sequence.id)
      setTimeout(() => setSaveSuccess(false), 2500)
      loadSavedSequences()
    } catch (e: any) {
      setSaveError(e?.message || 'Errore di rete')
    } finally {
      setSaving(false)
    }
  }

  const loadSequence = (seq: SavedSequence) => {
    setCurrentId(seq.id)
    setSavingName(seq.name)
    setCompanyName(seq.company_name || '')
    setWebsite(seq.website || '')
    setService(seq.service || '')
    setSenderName(seq.sender_name || '')
    setSenderCompany(seq.sender_company || '')
    setTone(seq.tone || 'professionale')
    setSequence(Array.isArray(seq.steps) ? seq.steps : [])
    setSteps(Array.isArray(seq.steps) && seq.steps.length > 0 ? seq.steps.length : 4)
    setShowSaved(false)
  }

  const deleteSequence = async (id: string) => {
    if (!confirm('Eliminare definitivamente questa sequenza salvata?')) return
    try {
      const res = await fetch(`/api/sequences/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (data?.ok) {
        setSaved((prev) => prev.filter((s) => s.id !== id))
        if (currentId === id) setCurrentId(null)
      } else {
        alert(data?.error || 'Errore eliminazione')
      }
    } catch (e: any) {
      alert(e?.message || 'Errore di rete')
    }
  }

  const newBlankSequence = () => {
    setCurrentId(null)
    setSavingName('')
    setSequence([])
    setSaveSuccess(false)
    setSaveError(null)
  }

  const openLaunchModal = (seqId: string, seqName: string) => {
    setLaunchSeqId(seqId)
    setLaunchSeqName(seqName)
    setLaunchRecipientEmail('')
    setLaunchRecipientName('')
    setLaunchSenderEmail(senderName || senderCompany ? '' : '') // start vuoto
    setLaunchSenderName(senderName || '')
    setLaunchError(null)
    setLaunchResult(null)
  }

  const closeLaunchModal = () => {
    setLaunchSeqId(null)
    setLaunchResult(null)
    setLaunchError(null)
  }

  const launchCampaign = async () => {
    if (!launchSeqId) return
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!re.test(launchRecipientEmail)) {
      setLaunchError('Email destinatario non valida')
      return
    }
    if (!re.test(launchSenderEmail)) {
      setLaunchError('Email mittente non valida')
      return
    }
    setLaunching(true)
    setLaunchError(null)
    try {
      const res = await fetch(`/api/sequences/${launchSeqId}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: launchRecipientEmail.trim(),
          recipientName: launchRecipientName.trim() || undefined,
          senderEmail: launchSenderEmail.trim(),
          senderName: launchSenderName.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (data?.tableMissing) {
        setLaunchError(
          'Le tabelle delle campagne non sono ancora attive. Applica la migration SQL dal commento in src/app/api/sequences/[id]/launch/route.ts.'
        )
        return
      }
      if (!data?.ok) {
        setLaunchError(data?.error || 'Errore lancio campagna')
        return
      }
      setLaunchResult({
        runId: data.runId,
        firstSent: !!data.firstSent,
        pendingCount: typeof data.pendingCount === 'number' ? data.pendingCount : 0,
        firstError: data.firstError || null,
        resendConfigured: !!data.resendConfigured,
      })
    } catch (e: any) {
      setLaunchError(e?.message || 'Errore di rete')
    } finally {
      setLaunching(false)
    }
  }

  const generate = useCallback(async () => {
    if (!companyName.trim()) return
    setLoading(true)
    setError(null)
    setSequence([])
    setCurrentId(null) // nuova generazione = nuova bozza
    try {
      const res = await fetch('/api/ai/generate-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, website, service, senderName, senderCompany, tone, steps }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Errore generazione')
      setSequence(data.sequence || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [companyName, website, service, senderName, senderCompany, tone, steps])

  const handleEdit = (idx: number, field: 'subject' | 'body', value: string) => {
    setSequence(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e))
  }

  const copyAll = () => {
    const text = sequence.map(e =>
      `--- Email ${e.step} (Giorno ${e.waitDays === 0 ? '1' : e.waitDays + 1}) ---\nOggetto: ${e.subject}\n\n${e.body}`
    ).join('\n\n')
    navigator.clipboard.writeText(text).then(() => { setAllCopied(true); setTimeout(() => setAllCopied(false), 2000) }).catch(() => {})
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Sequenze Email AI</h1>
            <p className="mt-1 text-sm text-slate-500">Genera, salva e riusa campagne di cold email multi-step personalizzate con l&apos;AI.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/dashboard/sequences/campaigns"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              title="Vedi le campagne attive"
            >
              <ListChecks className="w-4 h-4" /> Campagne attive
            </Link>
            <button
              type="button"
              onClick={() => setShowSaved((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              title="Sequenze salvate"
            >
              <FolderOpen className="w-4 h-4" /> Sequenze salvate ({saved.length})
            </button>
            {(sequence.length > 0 || currentId) && (
              <button
                type="button"
                onClick={newBlankSequence}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                title="Nuova sequenza"
              >
                <FileText className="w-4 h-4" /> Nuova
              </button>
            )}
          </div>
        </div>
      </div>

      {tableMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
          <div>
            <strong>Persistenza non attiva.</strong> Per salvare le sequenze, applica la migration SQL
            indicata in <code className="text-xs bg-amber-100 px-1 rounded">src/app/api/sequences/route.ts</code> (commento
            in cima al file) nel SQL Editor di Supabase.
          </div>
        </div>
      )}

      {showSaved && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Sequenze salvate</h2>
            <button
              type="button"
              onClick={() => setShowSaved(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
            >
              Chiudi
            </button>
          </div>
          <div className="p-4">
          {savedLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> Caricamento…
            </div>
          ) : saved.length === 0 ? (
            <p className="text-sm text-slate-400">
              {tableMissing
                ? 'Persistenza non attiva. Vedi avviso sopra.'
                : 'Nessuna sequenza salvata. Salva la tua prima sequenza dopo la generazione.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {saved.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 truncate">{s.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {Array.isArray(s.steps) ? s.steps.length : 0} email · {s.company_name || 'Senza azienda'} ·
                      {new Date(s.updated_at).toLocaleDateString('it-IT')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openLaunchModal(s.id, s.name)}
                      className="text-xs px-2 py-1 rounded-md bg-slate-900 text-white border border-slate-900 hover:bg-slate-800 flex items-center gap-1 transition-colors"
                      title="Lancia campagna"
                    >
                      <Rocket className="w-3 h-3" /> Lancia
                    </button>
                    <button
                      type="button"
                      onClick={() => loadSequence(s)}
                      className="text-xs px-2 py-1 rounded-md bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      Carica
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSequence(s.id)}
                      className="text-xs p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      title="Elimina"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      )}

      {/* Config Form */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-slate-900">Configura la sequenza</h2>
        </div>
        <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Building2 className="w-3 h-3 inline mr-1" />Azienda Target *</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Es. Ristorante Da Mario"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Globe className="w-3 h-3 inline mr-1" />Sito Web</label>
            <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="www.example.com"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Wrench className="w-3 h-3 inline mr-1" />Servizio da Vendere</label>
            <input value={service} onChange={e => setService(e.target.value)} placeholder="Es. Gestione Social Media"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><User className="w-3 h-3 inline mr-1" />Il Tuo Nome</label>
            <input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Mario Rossi"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Building2 className="w-3 h-3 inline mr-1" />La Tua Azienda</label>
            <input value={senderCompany} onChange={e => setSenderCompany(e.target.value)} placeholder="Digital Agency SRL"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Palette className="w-3 h-3 inline mr-1" />Tono</label>
            <select value={tone} onChange={e => setTone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none bg-white transition-colors">
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1"><Mail className="w-3 h-3 inline mr-1" />Numero Email (2-6)</label>
            <input type="number" min={2} max={6} value={steps} onChange={e => setSteps(Number(e.target.value) || 4)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors" />
          </div>
        </div>

        <button onClick={generate} disabled={loading || !companyName.trim()}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={1.75} />}
          {loading ? 'Generazione in corso...' : sequence.length > 0 ? 'Rigenera Sequenza' : 'Genera Sequenza Email'}
        </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Chiudi</button>
        </div>
      )}

      {/* Generated Sequence */}
      {sequence.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-slate-900">
              {currentId ? savingName || 'Sequenza salvata' : 'La Tua Sequenza'} ({sequence.length} email)
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowSaveForm(true)} disabled={tableMissing}
                className="text-sm px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                title={tableMissing ? 'Persistenza non attiva' : currentId ? 'Aggiorna sequenza salvata' : 'Salva questa sequenza'}>
                <Save className="w-3.5 h-3.5" /> {currentId ? 'Aggiorna' : 'Salva'}
              </button>
              {currentId && (
                <button onClick={() => openLaunchModal(currentId, savingName || companyName || 'Sequenza')}
                  className="text-sm px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1 transition-colors shadow-sm"
                  title="Lancia questa sequenza come campagna verso un destinatario">
                  <Rocket className="w-3.5 h-3.5" /> Lancia campagna
                </button>
              )}
              <button onClick={copyAll}
                className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 transition-colors">
                {allCopied ? <><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Copiato Tutto</> : <><Copy className="w-3.5 h-3.5" /> Copia Tutto</>}
              </button>
              <button onClick={generate} disabled={loading}
                className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 transition-colors disabled:opacity-50">
                <RotateCcw className="w-3.5 h-3.5" /> Rigenera
              </button>
            </div>
          </div>

          {saveSuccess && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Sequenza salvata.
            </div>
          )}

          {showSaveForm && (
            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
              <label className="block text-xs font-semibold text-slate-600">Nome sequenza</label>
              <input
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                placeholder={companyName ? `Es. ${companyName} - Cold outreach` : 'Nome della sequenza'}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors"
                autoFocus
              />
              {saveError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveSequence}
                  disabled={saving}
                  className="text-sm px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {saving ? 'Salvataggio…' : 'Conferma salvataggio'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSaveForm(false)
                    setSaveError(null)
                  }}
                  disabled={saving}
                  className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {sequence.map((e, i) => (
              <div key={i} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-md bg-white border border-slate-200 flex items-center justify-center text-xs font-semibold text-slate-700 tabular-nums">{e.step}</div>
                  <span className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
                    {e.waitDays === 0 ? 'Giorno 1' : `+${e.waitDays}gg`}
                  </span>
                </div>
                {i < sequence.length - 1 && <div className="w-8 h-px bg-slate-200 mx-1 mt-[-12px]" />}
              </div>
            ))}
          </div>

          {sequence.map((email, i) => (
            <EmailCard key={i} email={email} index={i} onEdit={handleEdit} />
          ))}
        </div>
      )}

      {/* Tips */}
      {sequence.length === 0 && !loading && (
        <div className="bg-white rounded-lg border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Suggerimenti per sequenze efficaci</h3>
          <ul className="space-y-1.5 text-sm text-slate-600">
            <li className="flex items-start gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" /> Specifica il servizio che vuoi vendere per email più mirate</li>
            <li className="flex items-start gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" /> Inserisci il sito web del target per riferimenti personalizzati</li>
            <li className="flex items-start gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" /> 4 email è il numero ottimale: intro → valore → social proof → urgenza</li>
            <li className="flex items-start gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" /> Dopo la generazione puoi modificare ogni email liberamente</li>
            <li className="flex items-start gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" /> Usa il tono "diretto" per settori competitivi, "consulenziale" per B2B premium</li>
          </ul>
        </div>
      )}

      {/* Launch Campaign Modal */}
      {launchSeqId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4"
          onClick={() => !launching && closeLaunchModal()}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center">
                  <Rocket className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
                </div>
                <h2 className="text-base font-semibold text-slate-900">Lancia campagna</h2>
              </div>
              <button
                onClick={closeLaunchModal}
                disabled={launching}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
                title="Chiudi"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {launchResult ? (
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-md bg-emerald-50 border border-emerald-100 mx-auto">
                  <CheckCircle className="w-6 h-6 text-emerald-600" strokeWidth={1.75} />
                </div>
                <h3 className="text-center text-base font-semibold text-slate-900">Campagna lanciata</h3>
                <div className="bg-slate-50 rounded-md border border-slate-200 p-4 space-y-2 text-sm">
                  {launchResult.firstSent ? (
                    <div className="flex items-start gap-2 text-emerald-700">
                      <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span><strong>Prima email inviata</strong> a {launchRecipientEmail}.</span>
                    </div>
                  ) : launchResult.firstError ? (
                    <div className="flex items-start gap-2 text-red-700">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>Prima email fallita: {launchResult.firstError}</span>
                    </div>
                  ) : !launchResult.resendConfigured ? (
                    <div className="flex items-start gap-2 text-amber-700">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>RESEND_API_KEY non configurata — le email sono schedulate ma non saranno inviate finché non configuri Resend.</span>
                    </div>
                  ) : null}

                  {launchResult.pendingCount > 0 && (
                    <div className="flex items-start gap-2 text-slate-700">
                      <Clock className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
                      <span>
                        <strong>{launchResult.pendingCount}</strong> email schedulate per i prossimi giorni.
                        Verranno inviate automaticamente dal cron.
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Link
                    href="/dashboard/sequences/campaigns"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
                  >
                    <ListChecks className="w-4 h-4" /> Vai alla campagna
                  </Link>
                  <button
                    onClick={closeLaunchModal}
                    className="px-4 py-2 rounded-md border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                  >
                    Chiudi
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-sm text-slate-600">
                    Stai per lanciare <strong className="text-slate-900">{launchSeqName}</strong> verso un destinatario.
                    La prima email parte subito, le successive seguono il ritardo in giorni della sequenza.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Email destinatario *</label>
                  <input
                    type="email"
                    value={launchRecipientEmail}
                    onChange={(e) => {
                      setLaunchRecipientEmail(e.target.value)
                      if (launchError) setLaunchError(null)
                    }}
                    placeholder="nome@azienda.it"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nome destinatario (opzionale)</label>
                  <input
                    type="text"
                    value={launchRecipientName}
                    onChange={(e) => setLaunchRecipientName(e.target.value)}
                    placeholder="Mario Rossi"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors"
                  />
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Email mittente *</label>
                    <input
                      type="email"
                      value={launchSenderEmail}
                      onChange={(e) => {
                        setLaunchSenderEmail(e.target.value)
                        if (launchError) setLaunchError(null)
                      }}
                      placeholder="tu@tuodominio.it"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Deve essere un dominio verificato in Resend. Altrimenti la consegna fallirà.
                    </p>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Nome mittente (opzionale)</label>
                    <input
                      type="text"
                      value={launchSenderName}
                      onChange={(e) => setLaunchSenderName(e.target.value)}
                      placeholder="Il tuo nome o azienda"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-900 focus:border-slate-900 outline-none transition-colors"
                    />
                  </div>
                </div>

                {launchError && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{launchError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={closeLaunchModal}
                    disabled={launching}
                    className="px-4 py-2 rounded-md border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={launchCampaign}
                    disabled={launching || !launchRecipientEmail.trim() || !launchSenderEmail.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {launching ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Lancio…
                      </>
                    ) : (
                      <>
                        <Rocket className="w-4 h-4" /> Lancia campagna
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SequencesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-500">Caricamento...</div>}>
      <SequencesContent />
    </Suspense>
  )
}
