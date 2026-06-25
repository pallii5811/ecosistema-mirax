'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Info, Linkedin, Loader2, Mail, MessageCircle, Phone, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { generateWhatsAppPitchAction } from '@/app/dashboard/actions'

type OutreachMode = 'sell_service' | 'mirax_promo'

// Guardrail window: warn before contacting a lead reached within this many days.
const RECENT_CONTACT_DAYS = 7

type Props = {
  nome: string
  citta?: string
  categoria?: string
  sito?: string
  email?: string
  telefono?: string
  problems?: string[]
  /** Optional lead id (for persistent audit logging). */
  leadId?: string
  /** Default message generation mode. */
  defaultMode?: OutreachMode
  /** Optional pre-generated email pitch to reuse for the Email channel. */
  pitchSubject?: string
  pitchBody?: string
  /** Called after the user fires any outreach channel (to track "contacted"). */
  onContacted?: () => void
  /** Called after a contact is persisted to the outreach log (to refresh status). */
  onLogged?: () => void
  /** ISO timestamp of the last time this lead was contacted (for the anti-duplicate guardrail). */
  lastContactedAt?: string | null
  /** Visual style of the trigger button. */
  variant?: 'primary' | 'dark'
  className?: string
  /** Optional custom label for the trigger button. */
  label?: string
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

// Normalizes an Italian phone number into the wa.me international format (no +).
function toWhatsAppNumber(raw: string | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8) return null
  if (digits.startsWith('39')) return digits
  if (digits.startsWith('0039')) return digits.slice(2)
  return `39${digits}`
}

export function OutreachLauncher({
  nome,
  citta,
  categoria,
  sito,
  email,
  telefono,
  problems = [],
  leadId,
  defaultMode = 'sell_service',
  pitchSubject,
  pitchBody,
  onContacted,
  onLogged,
  lastContactedAt,
  variant = 'dark',
  className,
  label = 'Contatta',
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [rationale, setRationale] = useState('')
  const [copied, setCopied] = useState(false)
  const [generatedOnce, setGeneratedOnce] = useState(false)
  const [mode, setMode] = useState<OutreachMode>(defaultMode)
  const [recontactAck, setRecontactAck] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Esc to close + lock body scroll while the modal is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Focus the message as soon as it is ready, for a keyboard-first flow.
  useEffect(() => {
    if (open && !loading) textareaRef.current?.focus()
  }, [open, loading])

  const waNumber = toWhatsAppNumber(telefono)
  const hasEmail = typeof email === 'string' && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(email)
  const canOpen = Boolean(waNumber) || hasEmail || Boolean(telefono)

  const lastDays = daysSince(lastContactedAt)
  const recentlyContacted = lastDays !== null && lastDays <= RECENT_CONTACT_DAYS
  // Anti-duplicate guardrail (human-in-the-loop): block channels until the user confirms re-contact.
  const blockedByGuardrail = recentlyContacted && !recontactAck

  const generateMessage = async (forMode: OutreachMode) => {
    setLoading(true)
    try {
      const res = await generateWhatsAppPitchAction({ nome, citta, categoria, sito, problems, mode: forMode })
      setMessage(res.message)
      setRationale(res.rationale || '')
    } catch {
      setMessage(`Buongiorno, le scrivo riguardo a ${nome || 'la vostra azienda'}. Posso mostrarle in 2 minuti come portare più clienti? Quando ha un momento per sentirci?`)
      setRationale('')
    } finally {
      setGeneratedOnce(true)
      setLoading(false)
    }
  }

  const ensureMessage = async () => {
    if (generatedOnce || message.trim()) return
    await generateMessage(mode)
  }

  const handleOpen = async () => {
    setOpen(true)
    await ensureMessage()
  }

  const switchMode = async (next: OutreachMode) => {
    if (next === mode) return
    setMode(next)
    await generateMessage(next)
  }

  // Persist the action to the audit log (best-effort, never blocks the channel).
  const logContact = (channel: string) => {
    try {
      void fetch('/api/outreach/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          website: sito,
          name: nome,
          channel,
          message: message.trim() || undefined,
          rationale: rationale.trim() || undefined,
          mode,
          status: 'sent',
        }),
      })
        .then(() => {
          try {
            onLogged?.()
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          /* network best-effort */
        })
    } catch {
      /* ignore */
    }
  }

  const fireContacted = (channel: string) => {
    try {
      onContacted?.()
    } catch {
      /* non-blocking */
    }
    logContact(channel)
  }

  const openWhatsApp = () => {
    if (!waNumber) return
    const text = encodeURIComponent(message.trim())
    window.open(`https://wa.me/${waNumber}?text=${text}`, '_blank', 'noopener,noreferrer')
    fireContacted('whatsapp')
  }

  const openEmail = () => {
    if (!hasEmail) return
    const subject = encodeURIComponent(pitchSubject || `Proposta per ${nome}`)
    const body = encodeURIComponent(message.trim() || pitchBody || '')
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank')
    fireContacted('email')
  }

  const openTelegram = () => {
    const url = encodeURIComponent(sito || 'https://www.miraxgroup.it')
    const text = encodeURIComponent(message.trim())
    window.open(`https://t.me/share/url?url=${url}&text=${text}`, '_blank', 'noopener,noreferrer')
    fireContacted('telegram')
  }

  const openLinkedIn = () => {
    const q = encodeURIComponent(nome || '')
    window.open(`https://www.linkedin.com/search/results/all/?keywords=${q}`, '_blank', 'noopener,noreferrer')
    fireContacted('linkedin')
  }

  const openCall = () => {
    if (!telefono) return
    window.open(`tel:${telefono.replace(/\s/g, '')}`, '_blank')
    fireContacted('call')
  }

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  const triggerStyle =
    variant === 'primary'
      ? 'bg-violet-600 hover:bg-violet-700 text-white'
      : 'bg-zinc-900 hover:bg-zinc-800 text-white'

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={!canOpen}
        title={canOpen ? 'Contatta su più canali' : 'Nessun contatto disponibile'}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-zinc-400 ${triggerStyle} ${className || ''}`}
      >
        <MessageCircle size={14} />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Contatta ${nome || 'lead'}`}
            className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <div className="text-base font-semibold text-slate-900 truncate">Contatta {nome || 'lead'}</div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  {[citta, categoria].filter(Boolean).join(' · ') || 'Messaggio personalizzato multi-canale'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-8 w-8 rounded-md text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                title="Chiudi"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {recentlyContacted && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">
                      Lead già contattato {lastDays === 0 ? 'oggi' : `${lastDays} giorn${lastDays === 1 ? 'o' : 'i'} fa`}
                    </div>
                    <p className="mt-0.5 text-amber-700">
                      Guardrail anti-duplicato: evita di ricontattare troppo presto.{' '}
                      {!recontactAck && 'Conferma per procedere comunque.'}
                    </p>
                    {!recontactAck && (
                      <button
                        type="button"
                        onClick={() => setRecontactAck(true)}
                        className="mt-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        Conferma ricontatto
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => switchMode('sell_service')}
                  disabled={loading}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                    mode === 'sell_service' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Vendi il tuo servizio
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('mirax_promo')}
                  disabled={loading}
                  className={`flex-1 inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                    mode === 'mirax_promo' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Sparkles className="h-3 w-3" /> Promo MIRAX
                </button>
              </div>

              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Messaggio (modificabile)
              </label>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder={loading ? 'Generazione messaggio…' : 'Scrivi o genera un messaggio…'}
                  disabled={loading}
                  aria-label="Messaggio di outreach"
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-slate-50"
                />
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-lg">
                    <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={copyMessage}
                    disabled={!message.trim()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copiato' : 'Copia'}
                  </button>
                  <button
                    type="button"
                    onClick={() => generateMessage(mode)}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Rigenera
                  </button>
                </div>
                <span className="text-[11px] text-slate-400">{message.trim().length} caratteri</span>
              </div>

              {rationale.trim() && !loading && (
                <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-500" />
                  <div>
                    <span className="font-semibold text-slate-700">Perché questo messaggio: </span>
                    {rationale.trim()}
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 pb-5 pt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={openWhatsApp}
                disabled={!waNumber || !message.trim() || blockedByGuardrail}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={waNumber ? 'Apri WhatsApp con messaggio precompilato' : 'Nessun numero disponibile'}
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </button>
              <button
                type="button"
                onClick={openEmail}
                disabled={!hasEmail || blockedByGuardrail}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={hasEmail ? 'Apri email precompilata' : 'Nessuna email disponibile'}
              >
                <Mail className="h-4 w-4" /> Email
              </button>
              <button
                type="button"
                onClick={openTelegram}
                disabled={!message.trim() || blockedByGuardrail}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Condividi su Telegram"
              >
                <Send className="h-4 w-4" /> Telegram
              </button>
              <button
                type="button"
                onClick={openLinkedIn}
                disabled={blockedByGuardrail}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0a66c2] hover:bg-[#084e96] text-white text-sm font-semibold py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Cerca l'azienda su LinkedIn"
              >
                <Linkedin className="h-4 w-4" /> LinkedIn
              </button>
              {telefono ? (
                <button
                  type="button"
                  onClick={openCall}
                  disabled={blockedByGuardrail}
                  className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Chiama"
                >
                  <Phone className="h-4 w-4" /> Chiama {telefono}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default OutreachLauncher
