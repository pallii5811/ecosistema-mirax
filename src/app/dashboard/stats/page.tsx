'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Flame, Loader2, Trophy, Target, Send, ChevronDown, ChevronUp,
  ArrowRight, Search, MapPin, Tag, Globe, Sparkles, Info, Settings2,
  Phone, CheckCircle, XCircle, TrendingUp,
} from 'lucide-react'

type HotLead = {
  id: string
  source: 'pipeline'
  lead_name: string
  lead_website: string | null
  lead_city: string | null
  lead_category: string | null
  lead_score: number
  stage: string
  deal_value: number
  updated_at: string
}

type Stats = { total: number; contacted: number; won: number; lost: number; conversionRate: number }
type Pattern = { name: string; total: number; won: number; revenue: number; winRate: number } | null
type ModelWeights = {
  weight_no_pixel: number; weight_has_email: number; weight_seo_errors: number;
  weight_no_gtm: number; weight_slow_speed: number; weight_no_ssl: number; weight_no_google_ads: number;
  last_trained_at?: string | null; total_conversions?: number; total_rejections?: number;
}

const STAGE_STYLE: Record<string, { label: string; dot: string }> = {
  nuovo: { label: 'Nuovo', dot: 'bg-slate-400' },
  contattato: { label: 'Contattato', dot: 'bg-blue-500' },
  meeting: { label: 'Meeting', dot: 'bg-violet-500' },
  proposta: { label: 'Proposta', dot: 'bg-amber-500' },
  vinto: { label: 'Vinto', dot: 'bg-emerald-500' },
  perso: { label: 'Perso', dot: 'bg-slate-300' },
}

function ScoreBadge({ score }: { score: number }) {
  let dot = 'bg-slate-300'
  let label = 'Bassa'
  let textColor = 'text-slate-600'
  if (score >= 70) { dot = 'bg-red-500'; label = 'Hot'; textColor = 'text-red-700' }
  else if (score >= 50) { dot = 'bg-amber-500'; label = 'Caldo'; textColor = 'text-amber-700' }
  else if (score >= 30) { dot = 'bg-blue-500'; label = 'Tiepido'; textColor = 'text-blue-700' }
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="text-sm font-semibold text-slate-900 tabular-nums">{score}</span>
      <span className={`text-[10px] font-medium uppercase tracking-wide ${textColor}`}>{label}</span>
    </div>
  )
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

export default function HotlistPage() {
  const [hotlist, setHotlist] = useState<HotLead[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [bestCat, setBestCat] = useState<Pattern>(null)
  const [bestCity, setBestCity] = useState<Pattern>(null)
  const [model, setModel] = useState<ModelWeights | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModel, setShowModel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/insights/hotlist', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      setHotlist(Array.isArray(data?.hotlist) ? data.hotlist : [])
      setStats(data?.stats || null)
      setBestCat(data?.patterns?.bestCategory || null)
      setBestCity(data?.patterns?.bestCity || null)
      setModel(data?.model || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const hotCount = hotlist.filter(h => h.lead_score >= 70).length
  const warmCount = hotlist.filter(h => h.lead_score >= 50 && h.lead_score < 70).length

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Lead Hotlist</h1>
        <p className="mt-1 text-sm text-slate-500">
          I tuoi lead ordinati dal più caldo al più freddo secondo il punteggio AI personalizzato.
        </p>
      </div>

      {/* Spiegazione (banner che educa l'utente) */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center">
            <Info className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Come funziona il Lead Score AI</h2>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">
              Mirax analizza il sito web di ogni azienda e assegna un punteggio da <span className="font-medium text-slate-900">0 a 100</span>.
              Più alto è lo score, più probabile che quel lead abbia bisogno del tuo servizio.
              I lead <span className="font-medium text-slate-900">Hot (70+)</span> hanno fino a <span className="font-medium text-slate-900">3x più probabilità</span> di chiusura.
              Il modello impara dalle tue conversioni e migliora nel tempo.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-white p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
            <Flame className="w-3.5 h-3.5 text-red-500" strokeWidth={1.75} /> Hot (70+)
          </div>
          <div className="text-xl font-semibold text-slate-900 tabular-nums">{hotCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">lead caldi da contattare ora</div>
        </div>
        <div className="bg-white p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
            <Target className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} /> Caldi (50-69)
          </div>
          <div className="text-xl font-semibold text-slate-900 tabular-nums">{warmCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">da nutrire con sequenze</div>
        </div>
        <div className="bg-white p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
            <Trophy className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} /> Win rate
          </div>
          <div className="text-xl font-semibold text-slate-900 tabular-nums">{stats?.conversionRate ?? 0}%</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {stats ? `${stats.won}/${stats.won + stats.lost} chiusi` : '—'}
          </div>
        </div>
        <div className="bg-white p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} /> Pipeline tot.
          </div>
          <div className="text-xl font-semibold text-slate-900 tabular-nums">{stats?.total ?? 0}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">lead in pipeline</div>
        </div>
      </div>

      {/* Pattern recognition */}
      {(bestCat || bestCity) && stats && stats.won > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-slate-900">Dove converti di più</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-200">
            {bestCat && bestCat.won > 0 && (
              <div className="bg-white p-5">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Categoria vincente</div>
                <div className="text-base font-semibold text-slate-900 mt-1 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-slate-400" strokeWidth={1.75} /> {bestCat.name}
                </div>
                <div className="text-xs text-slate-500 mt-1 tabular-nums">
                  <span className="font-medium text-slate-900">{bestCat.winRate}%</span> win rate · <span className="font-medium text-slate-900">{formatCurrency(bestCat.revenue)}</span> chiusi
                </div>
                <Link
                  href={`/dashboard?q=${encodeURIComponent(bestCat.name)}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-900 hover:text-slate-700 transition-colors"
                >
                  Cerca altri "{bestCat.name}" <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            )}
            {bestCity && bestCity.won > 0 && (
              <div className="bg-white p-5">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Città vincente</div>
                <div className="text-base font-semibold text-slate-900 mt-1 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-400" strokeWidth={1.75} /> {bestCity.name}
                </div>
                <div className="text-xs text-slate-500 mt-1 tabular-nums">
                  <span className="font-medium text-slate-900">{bestCity.winRate}%</span> win rate · <span className="font-medium text-slate-900">{formatCurrency(bestCity.revenue)}</span> chiusi
                </div>
                <Link
                  href={`/dashboard?q=${encodeURIComponent('aziende a ' + bestCity.name)}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-900 hover:text-slate-700 transition-colors"
                >
                  Cerca altre aziende a {bestCity.name} <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* HOTLIST TABLE */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-slate-900">I tuoi {Math.min(hotlist.length, 20)} lead più caldi</h2>
          </div>
          <Link
            href="/dashboard/pipeline"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors"
          >
            Vai alla Pipeline <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : hotlist.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-3">
              <Search className="w-5 h-5 text-slate-400" strokeWidth={1.75} />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Nessun lead in pipeline</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              Inizia con una ricerca per trovare aziende. Aggiungile alla pipeline e Mirax inizierà a calcolare lo score per ogni lead.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 mt-5 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
            >
              <Search className="w-4 h-4" /> Fai la prima ricerca
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {hotlist.map((lead, idx) => {
              const stage = STAGE_STYLE[lead.stage] || STAGE_STYLE.nuovo
              return (
                <div key={lead.id} className="px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-50 border border-slate-200 text-[11px] font-semibold text-slate-500 tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 truncate">{lead.lead_name}</div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
                          {lead.lead_website && (
                            <span className="flex items-center gap-1 truncate">
                              <Globe className="w-3 h-3 flex-shrink-0" strokeWidth={1.75} /> {lead.lead_website}
                            </span>
                          )}
                          {lead.lead_city && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" strokeWidth={1.75} /> {lead.lead_city}
                            </span>
                          )}
                          {lead.lead_category && (
                            <span className="flex items-center gap-1">
                              <Tag className="w-3 h-3" strokeWidth={1.75} /> {lead.lead_category}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <ScoreBadge score={lead.lead_score} />

                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-700">
                      <span className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />
                      {stage.label}
                    </span>

                    {lead.deal_value > 0 && (
                      <span className="text-[11px] font-semibold tabular-nums text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                        {formatCurrency(lead.deal_value)}
                      </span>
                    )}

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Link
                        href="/dashboard/pipeline"
                        className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium transition-colors"
                        title="Vai a questo deal nella Pipeline"
                      >
                        Apri
                      </Link>
                      <Link
                        href={`/dashboard/sequences?name=${encodeURIComponent(lead.lead_name)}${lead.lead_website ? `&website=${encodeURIComponent(lead.lead_website)}` : ''}`}
                        className="text-xs px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium flex items-center gap-1 transition-colors"
                        title="Genera una sequenza email su misura per questo lead"
                      >
                        <Send className="w-3 h-3" /> Sequenza
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Personalizza modello (collapsed by default) */}
      {model && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowModel((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
              <span className="text-sm font-semibold text-slate-900">Personalizza il modello AI</span>
              <span className="text-[11px] text-slate-400 hidden md:inline">— scopri come Mirax calcola lo score</span>
            </div>
            {showModel ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {showModel && (
            <div className="px-5 pb-5 border-t border-slate-200 pt-4 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs text-slate-600 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-400" strokeWidth={1.75} />
                <span>
                  Ogni lead riceve uno score sommando questi pesi se il suo sito ha quel problema.
                  Un sito senza Pixel Facebook (+25), senza GTM (+15) e con errori SEO (+15) prende già <span className="font-medium text-slate-900">55 punti</span>.
                  Più alto il punteggio, più probabile che il proprietario ti dirà "sì".
                  Il modello si auto-tara dopo le prime 5 conversioni o rifiuti che registri.
                </span>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: 'Senza Facebook Pixel (tracking marketing assente)', value: model.weight_no_pixel, max: 25 },
                  { label: 'Email pubblica trovata (contatto raggiungibile)', value: model.weight_has_email, max: 20 },
                  { label: 'Errori SEO (sito mal ottimizzato)', value: model.weight_seo_errors, max: 15 },
                  { label: 'Senza Google Tag Manager', value: model.weight_no_gtm, max: 15 },
                  { label: 'Sito lento (>3s caricamento)', value: model.weight_slow_speed, max: 10 },
                  { label: 'Senza certificato SSL', value: model.weight_no_ssl, max: 10 },
                  { label: 'Senza Google Ads attive', value: model.weight_no_google_ads, max: 5 },
                ].map((it) => (
                  <div key={it.label} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 w-56 md:w-72 flex-shrink-0">{it.label}</span>
                    <div className="flex-1 bg-slate-100 rounded h-1.5 overflow-hidden">
                      <div
                        className="bg-slate-900 h-1.5 rounded transition-all"
                        style={{ width: `${(Number(it.value) / it.max) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-900 w-10 text-right tabular-nums">+{Math.round(Number(it.value))}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-500 flex-wrap pt-3 border-t border-slate-100">
                <div className="flex items-center gap-1 tabular-nums">
                  <CheckCircle className="w-3 h-3 text-emerald-500" strokeWidth={1.75} />
                  {model.total_conversions || 0} conversioni
                </div>
                <div className="flex items-center gap-1 tabular-nums">
                  <XCircle className="w-3 h-3 text-slate-400" strokeWidth={1.75} />
                  {model.total_rejections || 0} rifiuti
                </div>
                <div className="flex items-center gap-1">
                  <Phone className="w-3 h-3 text-slate-400" strokeWidth={1.75} />
                  {model.last_trained_at
                    ? `Ri-allenato il ${new Date(model.last_trained_at).toLocaleDateString('it-IT')}`
                    : 'Si attiverà dopo 5 conversioni/rifiuti'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
