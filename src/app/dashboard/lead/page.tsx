'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  Globe, Phone, Mail, MapPin, Tag, Star,
  Zap, AlertTriangle, CheckCircle, XCircle, ArrowLeft,
  Copy, ChevronDown, ChevronUp, Target, DollarSign, Lightbulb,
  BarChart3, Send
} from 'lucide-react'
import Link from 'next/link'
import { analyzeLead } from '@/utils/leadIntelligence'
import type { LeadIntelligence } from '@/utils/leadIntelligence'
import { analyzeBuyingSignals, buildPitchMessage } from '@/utils/buyingSignals'
import { AddToPipelineButton } from '@/components/AddToPipelineButton'

const TAG_COLORS: Record<string, string> = {
  red: 'bg-red-50 text-red-700 border-red-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
}

function MaturityGauge({ value, label }: { value: number; label: string }) {
  const color = value >= 70 ? 'text-emerald-500' : value >= 40 ? 'text-amber-500' : 'text-red-500'
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#e2e8f0" strokeWidth="10" />
          <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor"
            className={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${(value / 100) * 314} 314`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-black ${color}`}>{value}</span>
          <span className="text-[10px] text-slate-400 font-medium">/ 100</span>
        </div>
      </div>
      <span className={`text-xs font-bold mt-1 ${color}`}>{label}</span>
    </div>
  )
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, string> = {
    alta: 'bg-red-100 text-red-700 border-red-300',
    media: 'bg-amber-100 text-amber-700 border-amber-300',
    bassa: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  }
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${map[urgency] || map.bassa}`}>
      Urgenza: {urgency.charAt(0).toUpperCase() + urgency.slice(1)}
    </span>
  )
}

function Section({ title, icon: Icon, children, defaultOpen = true }: { title: string; icon: ComponentType<{ className?: string }>; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-violet-600" />
          <span className="font-bold text-sm text-slate-900">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-slate-100 pt-3">{children}</div>}
    </div>
  )
}

function LeadDetailContent() {
  const searchParams = useSearchParams()
  const [copied, setCopied] = useState(false)
  const [pitchCopied, setPitchCopied] = useState(false)

  const lead = useMemo(() => {
    const raw = searchParams.get('data')
    if (!raw) return null
    try { return JSON.parse(decodeURIComponent(raw)) } catch { return null }
  }, [searchParams])

  const intel: LeadIntelligence | null = useMemo(() => lead ? analyzeLead(lead) : null, [lead])
  const buyingSignals = useMemo(() => lead ? analyzeBuyingSignals(lead) : null, [lead])

  if (!lead || !intel || !buyingSignals) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Nessun lead selezionato.</p>
        <Link href="/dashboard" className="text-violet-600 underline text-sm mt-2 inline-block">Torna alla ricerca</Link>
      </div>
    )
  }

  const nome = lead.azienda || lead.nome || lead.name || lead.business_name || 'Azienda'
  const sito = lead.sito || lead.website || ''
  const telefono = lead.telefono || lead.phone || ''
  const email = lead.email || ''
  const citta = lead.citta || lead.city || ''
  const categoria = lead.categoria || lead.category || ''
  const rating = typeof lead.rating === 'number' ? lead.rating : typeof lead.stelle === 'number' ? lead.stelle : null
  const instagram = lead.instagram || ''
  const score = typeof lead.score_ai === 'number' ? lead.score_ai : typeof lead.nexa_score === 'number' ? lead.nexa_score : 0

  const copyAllData = () => {
    const lines = [
      `Azienda: ${nome}`,
      sito ? `Sito: ${sito}` : '',
      telefono ? `Telefono: ${telefono}` : '',
      email ? `Email: ${email}` : '',
      citta ? `Città: ${citta}` : '',
      categoria ? `Categoria: ${categoria}` : '',
      `Score: ${score}/100`,
      `Digital Maturity: ${intel.digitalMaturity}/100 (${intel.digitalMaturityLabel})`,
      `Urgenza: ${intel.urgency}`,
      `Valore Deal Stimato: €${intel.estimatedDealRange.min.toLocaleString('it-IT')} – €${intel.estimatedDealRange.max.toLocaleString('it-IT')}`,
      `Buying Signal Score: ${buyingSignals.score}/100 (${buyingSignals.label})`,
      `Segnale principale: ${buyingSignals.primaryReason}`,
      '',
      'Segnali d’acquisto verificabili:',
      ...buyingSignals.strongestSignals.map(s => `  - ${s.title}: ${s.evidence.map(e => `${e.label}=${e.value}`).join('; ')}`),
      '',
      'Servizi Suggeriti:',
      ...intel.suggestedServices.map(s => `  - ${s}`),
      '',
      'Strategia:',
      intel.suggestedApproach,
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(lines).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }

  return (
    <div className="space-y-5">
      {/* Back */}
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-violet-600 transition">
        <ArrowLeft className="w-4 h-4" /> Torna alla ricerca
      </Link>

      {/* Header Card */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 rounded-2xl p-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black">{nome}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-white/80 text-sm">
              {sito && <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{sito}</span>}
              {citta && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{citta}</span>}
              {categoria && <span className="flex items-center gap-1"><Tag className="w-3.5 h-3.5" />{categoria}</span>}
              {rating !== null && <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" />{rating}/5</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <MaturityGauge value={intel.digitalMaturity} label={intel.digitalMaturityLabel} />
            <div className="text-center">
              <div className="text-3xl font-black">{score}</div>
              <div className="text-xs text-white/70">Nexa Score</div>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-white/20">
          <AddToPipelineButton leadName={nome} leadWebsite={sito} leadPhone={telefono} leadEmail={email} leadCity={citta} leadCategory={categoria} leadScore={score} size="md" />
          <Link href={`/dashboard/sequences?name=${encodeURIComponent(nome)}&website=${encodeURIComponent(sito)}&service=${encodeURIComponent(intel.suggestedServices[0] || '')}`}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30 transition font-medium"
          >
            <Send className="w-3.5 h-3.5" /> Genera Sequenza Email
          </Link>
          <button onClick={copyAllData}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30 transition font-medium"
          >
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Copiato!' : 'Copia Dati'}
          </button>
        </div>
      </div>

      {/* Urgency + Deal Value */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-2 font-medium">Urgenza</div>
          <UrgencyBadge urgency={intel.urgency} />
          <p className="text-xs text-slate-500 mt-2">{intel.urgencyReason}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-1 font-medium">Valore Deal Stimato</div>
          <div className="text-xl font-black text-emerald-600">
            €{intel.estimatedDealRange.min.toLocaleString('it-IT')} – €{intel.estimatedDealRange.max.toLocaleString('it-IT')}
          </div>
          <p className="text-xs text-slate-400 mt-1">Basato sui servizi necessari</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-1 font-medium">Contatti</div>
          <div className="space-y-1">
            {telefono && <div className="flex items-center gap-1.5 text-sm"><Phone className="w-3 h-3 text-slate-400" />{telefono}</div>}
            {email && <div className="flex items-center gap-1.5 text-sm"><Mail className="w-3 h-3 text-slate-400" />{email}</div>}
            {instagram && <div className="flex items-center gap-1.5 text-sm text-pink-600">@{instagram}</div>}
            {!telefono && !email && <div className="text-xs text-slate-400">Nessun contatto disponibile</div>}
          </div>
        </div>
      </div>

      <Section title="Segnali d’Acquisto Verificabili" icon={Zap} defaultOpen={true}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
            <div className={`rounded-xl border p-4 ${
              buyingSignals.label === 'caldissimo' ? 'bg-red-50 border-red-200 text-red-700'
                : buyingSignals.label === 'caldo' ? 'bg-orange-50 border-orange-200 text-orange-700'
                  : buyingSignals.label === 'interessante' ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              <div className="text-xs font-semibold opacity-75">Buying Signal Score</div>
              <div className="mt-1 text-3xl font-black">{buyingSignals.score}</div>
              <div className="text-xs font-bold uppercase tracking-wide">{buyingSignals.label}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-semibold text-slate-500">Perché è interessante ora</div>
                {buyingSignals.signals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const message = buildPitchMessage(buyingSignals, {
                        company: typeof lead?.azienda === 'string' ? lead.azienda : (typeof lead?.nome === 'string' ? lead.nome : ''),
                        contactName: typeof lead?.referente === 'string' ? lead.referente : '',
                      })
                      if (!message) return
                      navigator.clipboard.writeText(message).then(() => { setPitchCopied(true); setTimeout(() => setPitchCopied(false), 2000) }).catch(() => {})
                    }}
                    title="Copia un messaggio di primo contatto costruito sui segnali reali di questo lead"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Copy className="w-3.5 h-3.5" /> {pitchCopied ? 'Copiato!' : 'Copia messaggio'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-900">{buyingSignals.primaryReason}</p>
              <p className="mt-2 text-xs text-slate-500">
                Mostriamo solo segnali derivati dai dati disponibili: audit sito, contatti, recensioni, ads, registry/P.IVA e campi reali del lead.
              </p>
            </div>
          </div>

          {buyingSignals.signals.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
              Nessun segnale d’acquisto forte verificabile con i dati disponibili. Servono più dati reali prima di considerarlo un lead caldo.
            </div>
          ) : (
            <div className="space-y-3">
              {buyingSignals.signals.slice(0, 6).map((signal) => (
                <div key={signal.id} className={`rounded-xl border p-4 ${
                  signal.severity === 'critical' ? 'border-red-200 bg-red-50'
                    : signal.severity === 'high' ? 'border-orange-200 bg-orange-50'
                      : 'border-amber-200 bg-amber-50'
                }`}>
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-900">{signal.title}</span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                          signal.severity === 'critical' ? 'bg-red-100 text-red-700 border-red-200'
                            : signal.severity === 'high' ? 'bg-orange-100 text-orange-700 border-orange-200'
                              : 'bg-amber-100 text-amber-700 border-amber-200'
                        }`}>
                          {signal.severity}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-700 leading-relaxed">{signal.reason}</p>
                    </div>
                    <div className="text-xs font-bold text-slate-500 shrink-0">
                      Confidenza {signal.confidence}%
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {signal.evidence.map((item, i) => (
                      <div key={`${signal.id}-evidence-${i}`} className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">{item.label}</div>
                        <div className="text-xs font-semibold text-slate-800">{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {signal.quantifiedImpact && (
                    <div className="mt-3 rounded-lg border border-slate-300 bg-white p-3">
                      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">Impatto sul business</div>
                      <div className="mt-0.5 text-sm font-black text-slate-900">{signal.quantifiedImpact.headline}</div>
                      <p className="mt-1 text-xs text-slate-700 leading-relaxed">{signal.quantifiedImpact.estimate}</p>
                      <div className="mt-2 text-[11px] text-slate-600">
                        <span className="font-bold text-slate-700">Come metterci un numero col cliente:</span> {signal.quantifiedImpact.howToQuantifyLive}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">Fonte: {signal.quantifiedImpact.benchmarkSource}</div>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="rounded-lg bg-white/70 border border-white/70 p-3">
                      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">Cosa vendere</div>
                      <div className="text-xs font-semibold text-slate-800 mt-1">{signal.serviceToSell}</div>
                    </div>
                    <div className="rounded-lg bg-white/70 border border-white/70 p-3">
                      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">Frase d’apertura</div>
                      <div className="text-xs text-slate-700 mt-1">{signal.openingLine}</div>
                    </div>
                    <div className="rounded-lg bg-white/70 border border-white/70 p-3">
                      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">Prossima azione</div>
                      <div className="text-xs text-slate-700 mt-1">{signal.nextBestAction}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Opportunity Tags */}
      <Section title="Opportunità Rilevate" icon={Target} defaultOpen={true}>
        <div className="space-y-2">
          {intel.opportunityTags.length === 0 && <p className="text-sm text-slate-400">Nessuna opportunità critica rilevata.</p>}
          {intel.opportunityTags.map((tag, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${TAG_COLORS[tag.color]}`}>
              <span className="text-lg leading-none mt-0.5">{tag.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm">{tag.label}</span>
                  {tag.estimatedValue && <span className="text-[11px] font-bold bg-white/80 px-1.5 py-0.5 rounded">{tag.estimatedValue}</span>}
                </div>
                <p className="text-xs mt-0.5 opacity-80">{tag.description}</p>
                {tag.service && <p className="text-[11px] mt-1 font-semibold opacity-60">Servizio: {tag.service}</p>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Score Breakdown */}
      <Section title="Breakdown Score AI" icon={BarChart3} defaultOpen={true}>
        <div className="space-y-2.5">
          {intel.scoreBreakdown.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 flex justify-center">
                {item.active
                  ? <CheckCircle className="w-4 h-4 text-violet-500" />
                  : <XCircle className="w-4 h-4 text-slate-300" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${item.active ? 'text-slate-900' : 'text-slate-400'}`}>{item.factor}</span>
                  <span className={`text-xs font-bold ${item.active ? 'text-violet-600' : 'text-slate-300'}`}>+{item.points} pt</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
                  <div className={`h-1.5 rounded-full transition-all ${item.active ? 'bg-violet-500' : 'bg-slate-200'}`}
                    style={{ width: `${item.points}%` }} />
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{item.tip}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Suggested Services */}
      {intel.suggestedServices.length > 0 && (
        <Section title="Servizi Suggeriti" icon={DollarSign} defaultOpen={true}>
          <div className="flex flex-wrap gap-2">
            {intel.suggestedServices.map((s, i) => (
              <span key={i} className="px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 text-sm font-medium">{s}</span>
            ))}
          </div>
        </Section>
      )}

      {/* AI Strategy */}
      <Section title="Strategia di Approccio AI" icon={Lightbulb} defaultOpen={true}>
        <p className="text-sm text-slate-700 leading-relaxed">{intel.suggestedApproach}</p>
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">{intel.competitorAdvantage}</p>
          </div>
        </div>
      </Section>
    </div>
  )
}

export default function LeadDetailPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-500">Caricamento...</div>}>
      <LeadDetailContent />
    </Suspense>
  )
}
