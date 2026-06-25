'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Sparkles,
  MapPin,
  Flame,
  ListPlus,
  Mail,
  Copy,
} from 'lucide-react'
import HeroMockupSidebar, {
  HERO_DEMO_LEADS,
  HERO_FILTER_CHIPS,
  HERO_MOCKUP_FILTER_CHIPS,
} from '@/components/landing/hero/HeroMockupSidebar'
import { HeroTypingQuery, useHeroAutoScroll } from '@/components/landing/hero/hero-mockup-motion'

const PHASE_MS = [10000, 6000, 6000] as const
const EASE = [0.22, 1, 0.36, 1] as const

function ScoreBadge({ score, tier }: { score: number; tier: 'HOT' | 'WARM' | 'OK' }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[13px] font-bold tabular-nums text-zinc-900 leading-none">{score}</span>
      <span
        className={`text-[7px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded leading-none ${
          tier === 'HOT' ? 'bg-zinc-900 text-white' : tier === 'WARM' ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-100 text-zinc-400'
        }`}
      >
        {tier}
      </span>
    </div>
  )
}

function SearchPhase() {
  const activeChip = 'senza Instagram'
  const [leadCount, setLeadCount] = useState(54)

  useEffect(() => {
    const steps = [54, 61, 68, 71]
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      if (i < steps.length) setLeadCount(steps[i])
    }, 2200)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="landing-mockup-search p-2.5 sm:p-4 pb-8 sm:pb-10 min-h-full max-w-full overflow-x-hidden box-border">
        <div className="flex items-center gap-1.5 mb-2 min-w-0">
          <MapPin size={13} className="text-violet-600 flex-shrink-0" />
          <h2 className="text-[11px] sm:text-sm font-bold text-slate-800 truncate">Ricerca Categoria e Città</h2>
        </div>

        <div className="landing-mockup-search__chips mb-2.5 sm:hidden">
          {HERO_MOCKUP_FILTER_CHIPS.map((label) => {
            const isActive = label === activeChip
            return (
              <span
                key={label}
                className={`landing-mockup-search__chip ${
                  isActive
                    ? 'landing-mockup-search__chip--active'
                    : ''
                }`}
              >
                {label}
              </span>
            )
          })}
        </div>

        <div className="hidden sm:flex items-center gap-1 flex-wrap mb-2.5 max-w-full">
          {HERO_FILTER_CHIPS.map((label) => {
            const isActive = label === activeChip
            return (
              <span
                key={label}
                className={`px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-semibold border whitespace-nowrap ${
                  isActive
                    ? 'bg-violet-100 border-violet-300 text-violet-700'
                    : 'bg-white border-slate-200 text-slate-500'
                }`}
              >
                {label}
              </span>
            )
          })}
        </div>

        {/* SniperArea — barra reale */}
        <div className="relative mb-2 max-w-full">
          <div className="flex items-center gap-1.5 sm:gap-2 bg-white rounded-full border-2 border-violet-200/70 shadow-lg shadow-violet-200/30 px-2.5 sm:px-4 py-1.5 min-w-0">
            <Search size={13} className="text-violet-500 flex-shrink-0 sm:w-[14px] sm:h-[14px]" />
            <div className="flex-1 min-w-0 overflow-hidden">
              <HeroTypingQuery />
            </div>
            <span className="hidden sm:inline text-[9px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2 py-1 flex-shrink-0">
              300 lead
            </span>
            <motion.span
              className="flex items-center gap-0.5 sm:gap-1 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold px-2 sm:px-3 py-1.5 rounded-full text-[9px] sm:text-[10px] shadow-md shadow-violet-500/20 flex-shrink-0"
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Search size={11} className="sm:w-3 sm:h-3" />
              <span className="hidden min-[380px]:inline">Cerca</span>
            </motion.span>
          </div>
          <div className="flex items-center justify-between px-3 mt-1.5">
            <div className="hidden sm:flex items-center gap-3">
              {[
                { color: 'bg-emerald-400', label: 'Database verificato' },
                { color: 'bg-violet-400', label: 'Ricerca AI' },
                { color: 'bg-blue-400', label: 'GDPR' },
              ].map((item) => (
                <span key={item.label} className="flex items-center gap-1 text-[9px] text-slate-400 font-medium">
                  <span className={`h-1 w-1 rounded-full ${item.color}`} />
                  {item.label}
                </span>
              ))}
            </div>
            <span className="text-[9px] font-semibold text-slate-400">10 crediti</span>
          </div>
        </div>

        {/* Progress — identico a DashboardShell */}
        <div className="flex items-center gap-2.5 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 mb-3 mx-0.5">
          <div className="relative h-8 w-8 flex-shrink-0 hidden sm:block">
            <svg className="absolute inset-0 animate-[miraxSpin_1.2s_linear_infinite]" width="32" height="32" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="17" fill="none" stroke="#ddd6fe" strokeWidth="2" />
              <circle cx="20" cy="20" r="17" fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="80" strokeDashoffset="24" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-violet-700">
              {leadCount} / 300 lead trovati — ricerca in corso
            </p>
            <p className="text-[9px] text-violet-500 mt-0.5 truncate">
              Nuovi risultati appariranno automaticamente. Puoi già consultare i lead trovati.
            </p>
            <div className="mt-1.5 bg-violet-200 rounded-full h-1 overflow-hidden relative">
              <motion.div
                className="h-1 rounded-full bg-violet-500 block"
                initial={{ width: '18%' }}
                animate={{ width: `${Math.round((leadCount / 300) * 100)}%` }}
                transition={{ duration: 0.85, ease: EASE }}
              />
            </div>
          </div>
        </div>

        {/* Ricerca Ambiente — nascosta su mobile stretto */}
        <div className="mb-3 hidden sm:block bg-gradient-to-r from-fuchsia-50 to-violet-50 border border-fuchsia-200 rounded-xl p-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                <Sparkles size={12} className="text-fuchsia-600 flex-shrink-0" />
                Ricerca Ambiente
              </h3>
              <p className="text-[9px] text-slate-500 mt-0.5 line-clamp-2">
                Ambiente è lo spazio contestuale dove le ricerche singole si relazionano tra loro creando una mappa semantica.
              </p>
            </div>
            <span className="flex-shrink-0 flex items-center gap-1 bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white font-bold px-3 py-2 rounded-lg text-[10px]">
              <Sparkles size={10} />
              Avvia Ricerca Ambiente
            </span>
          </div>
        </div>

        {/* Salva tutta la lista */}
        <div className="mb-3 hidden sm:flex flex-col items-center gap-1">
          <span className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold px-5 py-2 rounded-xl text-[11px] shadow-lg shadow-violet-500/25">
            <ListPlus size={14} />
            Salva tutta la lista
          </span>
          <p className="text-[8px] text-slate-400 text-center">Crea una lista con questi 71 lead</p>
        </div>

        {/* ResultsTable card */}
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-3 py-2.5 border-b border-zinc-100">
            <h3 className="text-[12px] font-bold text-zinc-900">Risultati della Ricerca</h3>
            <p className="text-[9px] text-zinc-500 mt-0.5">{leadCount} risultati per la query attiva</p>
            <div className="mt-2 hidden sm:flex flex-wrap gap-1">
              {['↕ Ordina per opportunità', 'Ordine Alfabetico', "↕ Per Segnali d'Acquisto", 'Solo caldi (54)'].map((btn, i) => (
                <span
                  key={btn}
                  className={`text-[8px] px-2 py-1 rounded-lg border font-semibold ${
                    i === 3 ? 'bg-rose-600 text-white border-rose-600 flex items-center gap-0.5' : 'bg-white text-zinc-600 border-zinc-200'
                  }`}
                >
                  {i === 3 && <Flame size={10} />}
                  {btn}
                </span>
              ))}
            </div>
          </div>

          {/* Mobile — lista compatta */}
          <div className="sm:hidden divide-y divide-zinc-100">
            {HERO_DEMO_LEADS.slice(0, 2).map((lead) => (
              <div key={lead.name} className="px-3 py-2.5 flex items-center gap-2 min-w-0">
                <ScoreBadge score={lead.score} tier={lead.tier} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold text-gray-900 truncate">{lead.name}</div>
                  <div className="text-[8px] text-violet-600 truncate">{lead.sito}</div>
                </div>
                <span className="text-[7px] font-medium px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200 flex-shrink-0">
                  {lead.opportunita}
                </span>
              </div>
            ))}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left min-w-[520px]">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  {['Nome', 'Score', 'Contatti', 'Città', 'Categoria', 'Opportunità', 'Rating', 'Speed', 'Azioni'].map((col) => (
                    <th key={col} className="px-1.5 py-1.5 text-[7px] font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {HERO_DEMO_LEADS.map((lead) => (
                  <tr key={lead.name} className="bg-white">
                    <td className="px-1.5 py-2 align-top max-w-[88px]">
                      <div className="text-[10px] font-semibold text-gray-900 truncate">{lead.name}</div>
                      <div className="text-[8px] text-violet-600 truncate">{lead.sito}</div>
                    </td>
                    <td className="px-1 py-2 text-center">
                      <ScoreBadge score={lead.score} tier={lead.tier} />
                    </td>
                    <td className="px-1.5 py-2 align-top">
                      <div className="text-[8px] text-emerald-600 font-mono">{lead.mobile}</div>
                      <div className={`text-[8px] truncate max-w-[72px] ${lead.email.includes('arrivo') ? 'text-amber-500 italic' : 'text-zinc-500'}`}>
                        {lead.email}
                      </div>
                    </td>
                    <td className="px-1 py-2 text-[8px] text-zinc-600">{lead.citta}</td>
                    <td className="px-1 py-2 text-[8px] text-zinc-600 max-w-[56px] truncate">{lead.categoria}</td>
                    <td className="px-1 py-2">
                      <span className="text-[7px] font-medium px-1 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200">
                        {lead.opportunita}
                      </span>
                      <span className="text-[7px] text-purple-600 ml-0.5">+{lead.extra}</span>
                    </td>
                    <td className="px-1 py-2 text-center text-[8px]">★ {lead.rating}</td>
                    <td className="px-1 py-2 text-center text-[8px] text-zinc-500">{lead.speed}</td>
                    <td className="px-1 py-2 min-w-[100px]">
                      <div className="space-y-0.5">
                        <div className="text-[7px] font-semibold bg-zinc-900 text-white text-center py-1 rounded">Dettaglio Lead</div>
                        <div className="text-[7px] font-semibold bg-violet-600 text-white text-center py-1 rounded flex items-center justify-center gap-0.5">
                          <Sparkles size={8} /> Genera Pitch
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
  )
}

function DetailPhase() {
  const modalScrollRef = useHeroAutoScroll(true)

  return (
    <div className="p-3 relative h-full min-h-full flex items-start justify-center">
      <div className="absolute inset-0 bg-gradient-to-b from-slate-100/80 to-white/90" />
      <div className="relative flex items-start justify-center pt-4 px-2 w-full">
        <div className="w-full max-w-[400px] rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Analisi Tecnica</div>
              <div className="mt-1 text-[13px] font-bold text-slate-900 leading-snug">
                Ink Factory Milano · Tatuatore · Milano
              </div>
            </div>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 text-slate-700 text-sm">×</span>
          </div>
          <div ref={modalScrollRef} className="px-4 py-3 space-y-3 max-h-[280px] overflow-y-auto scroll-smooth">
              <div>
                <div className="text-[10px] font-semibold text-slate-900">Errori SEO</div>
                <div className="mt-1.5 rounded-xl border border-red-200 bg-red-50 p-2.5 text-[9px] text-red-900">
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Meta description mancante sulla homepage</li>
                    <li>Mixed content: risorsa HTTP su pagina HTTPS</li>
                  </ul>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-900">Mancanze e Problemi (Priorità)</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {['NO INSTAGRAM', 'NO PIXEL', 'NO GTM', 'NO DMARC'].map((b) => (
                    <span key={b} className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-red-100 text-red-800 border-red-200">
                      {b}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-900">Stack Tecnologico (Presente)</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-200">SSL OK</span>
                  <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">WORDPRESS</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}

function PitchPhase() {
  return (
    <div className="p-3 relative h-full min-h-full flex items-center justify-center">
      <div className="w-full max-w-[380px] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden mx-2">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-[13px] font-bold text-slate-950">Pitch Commerciale</div>
          <div className="text-[9px] text-slate-500 mt-0.5">Ink Factory Milano · Milano · Tatuatore</div>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2">
              <div className="text-[8px] font-semibold text-slate-500 uppercase tracking-wide">Oggetto</div>
              <div className="mt-0.5 text-[10px] text-slate-900 font-medium">Opportunità Instagram per Ink Factory Milano</div>
            </div>
            <div className="px-3 py-2">
              <div className="text-[8px] font-semibold text-slate-500 uppercase tracking-wide">Corpo</div>
              <p className="mt-1 text-[10px] text-slate-900 leading-relaxed">
                Buongiorno, ho notato che Ink Factory Milano non ha ancora un profilo Instagram attivo mentre i competitor
                in zona ne hanno. Posso mostrarvi in 15 minuti come recuperare visibilità e richieste con una presenza social mirata.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5 pt-1">
            <span className="text-[9px] font-medium border border-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg">Chiudi</span>
            <span className="text-[9px] font-medium border border-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1">
              <Copy size={10} /> Copia testo
            </span>
            <span className="text-[9px] font-medium bg-violet-600 text-white px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1">
              <Mail size={10} /> Apri nel client mail
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export { SearchPhase, DetailPhase, PitchPhase }

const PHASES = [
  { id: 'search', label: 'Cerca', component: SearchPhase },
  { id: 'detail', label: 'Analizza', component: DetailPhase },
  { id: 'pitch', label: 'Chiudi', component: PitchPhase },
] as const

type Props = {
  onPhaseChange?: (phase: number) => void
}

export default function HeroDashboardMockup({ onPhaseChange }: Props) {
  const [phase, setPhase] = useState(0)
  const scrollRef = useHeroAutoScroll(phase === 0)

  const goPhase = (next: number) => {
    setPhase(next)
    onPhaseChange?.(next)
  }

  useEffect(() => {
    const duration = PHASE_MS[phase % PHASE_MS.length]
    const id = window.setTimeout(() => {
      goPhase((phase + 1) % PHASES.length)
    }, duration)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const PhaseBody = PHASES[phase].component

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-50/30">
        <HeroMockupSidebar />
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            ref={phase === 0 ? scrollRef : undefined}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden scroll-smooth [scrollbar-width:thin]"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={phase}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="min-h-full"
              >
                <PhaseBody />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center justify-center gap-3 border-t border-zinc-200 bg-zinc-50 py-2.5">
        {PHASES.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => goPhase(i)}
            className="flex items-center gap-1.5"
          >
            <span className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${i === phase ? 'bg-violet-600 scale-125' : 'bg-zinc-300'}`} />
            <span className={`text-[10px] font-medium transition-colors duration-300 ${i === phase ? 'text-violet-700' : 'text-zinc-400'}`}>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export { PHASES }
