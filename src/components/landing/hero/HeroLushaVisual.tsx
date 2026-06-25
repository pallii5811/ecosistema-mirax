'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Bell,
  Search,
  Sparkles,
  Mail,
  MapPin,
  Building2,
  Phone,
  Cloud,
  FileSpreadsheet,
  User,
  AlertTriangle,
} from 'lucide-react'
import { TypewriterCursor, useStaggerReveal, useTypewriter } from '@/components/landing/hero/hero-mockup-motion'

const EASE = [0.22, 1, 0.36, 1] as const

type StoryPhase = 'signal' | 'typing' | 'results' | 'audit' | 'sources' | 'pitch'

const SEARCH_QUERY = 'tatuatori Milano senza Instagram'

const LEADS = [
  { name: 'Ink Factory Milano', meta: 'Tatuatore · Milano', score: 84, hot: true },
  { name: 'Studio Bianchi', meta: 'Studio tattoo · Monza', score: 71, hot: false },
  { name: 'Palestra FitZone', meta: 'Fitness · Milano', score: 78, hot: true },
] as const

const AUDIT_TAGS = [
  { label: 'NO PIXEL', bad: true },
  { label: 'NO GTM', bad: true },
  { label: 'SSL OK', bad: false },
  { label: 'SEO −12', bad: true },
] as const

const SOURCE_ROWS = [
  { icon: MapPin, label: 'Profilo commerciale', value: 'Ink Factory Milano' },
  { icon: Building2, label: 'PEC verificata', value: 'inkfactory@pec.it' },
  { icon: Mail, label: 'Email DM', value: 'marco@inkfactory.it' },
  { icon: Phone, label: 'Mobile titolare', value: '+39 3** *** **42' },
] as const

const PITCH_TEXT = 'Ho notato che il vostro sito non traccia le conversioni Meta…'

const PHASE_ORDER: StoryPhase[] = ['signal', 'typing', 'results', 'audit', 'sources', 'pitch']

const PHASE_HOLD: Record<StoryPhase, number> = {
  signal: 2200,
  typing: 0,
  results: 3200,
  audit: 2800,
  sources: 3000,
  pitch: 3200,
}

const LAYER_SHIFT: Record<StoryPhase, { back: [number, number, number]; mid: [number, number, number] }> = {
  signal: { back: [20, 12, 2.5], mid: [10, 6, 1.2] },
  typing: { back: [16, 10, 2], mid: [8, 5, 1] },
  results: { back: [22, 14, 3], mid: [12, 7, 1.6] },
  audit: { back: [18, 11, 2.2], mid: [9, 5.5, 1.3] },
  sources: { back: [24, 15, 3.2], mid: [14, 8, 1.8] },
  pitch: { back: [17, 10, 2], mid: [8, 5, 1.1] },
}

function SignalsCard() {
  return (
    <motion.div
      key="signal"
      initial={{ opacity: 0, scale: 0.94, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -8 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="landing-hero__scene-inner"
    >
      <div className="landing-hero__scene-icon landing-hero__scene-icon--rose">
        <Bell size={22} strokeWidth={2.25} />
      </div>
      <div className="min-w-0">
        <p className="text-sm sm:text-base font-semibold text-zinc-900 tracking-tight">Segnali live</p>
        <p className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">Opportunità rilevate in tempo reale</p>
      </div>
    </motion.div>
  )
}

function TypingCard({ query, showCursor }: { query: string; showCursor: boolean }) {
  return (
    <motion.div
      key="typing"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="landing-hero__scene-search w-full"
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Ricerca in italiano</p>
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-3 py-2.5 shadow-sm min-h-[42px]">
        <Search size={14} className="text-violet-600 flex-shrink-0" />
        <span className="text-xs sm:text-sm text-zinc-800 font-medium truncate flex-1 text-left">
          {query}
          <TypewriterCursor visible={showCursor} />
        </span>
        <span className="text-[9px] font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-md flex-shrink-0">
          AI
        </span>
      </div>
      <motion.div
        className="mt-2.5 flex flex-wrap gap-1.5"
        initial={{ opacity: 0 }}
        animate={{ opacity: query.length > 8 ? 1 : 0.4 }}
        transition={{ duration: 0.3 }}
      >
        {['Milano', '16+ filtri', 'GDPR'].map((tag) => (
          <span key={tag} className="text-[9px] font-medium text-zinc-500 bg-zinc-100/90 px-2 py-1 rounded-full">
            {tag}
          </span>
        ))}
      </motion.div>
    </motion.div>
  )
}

function ResultsCard({ visible }: { visible: number }) {
  return (
    <motion.div
      key="results"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="landing-hero__scene-search w-full"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Risultati trovati</p>
        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md">3 lead</span>
      </div>
      <div className="space-y-1.5">
        {LEADS.map((lead, i) => (
          <motion.div
            key={lead.name}
            initial={{ opacity: 0, x: -12, height: 0 }}
            animate={
              i < visible
                ? { opacity: 1, x: 0, height: 'auto' }
                : { opacity: 0, x: -12, height: 0 }
            }
            transition={{ duration: 0.38, ease: EASE }}
            className={`landing-hero__result-row ${i === 0 && visible >= 1 ? 'landing-hero__result-row--active' : ''}`}
          >
            <div className="w-7 h-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
              {lead.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-zinc-900 truncate">{lead.name}</p>
              <p className="text-[9px] text-zinc-400 truncate">{lead.meta}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${lead.hot ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
                {lead.hot ? 'HOT' : 'WARM'}
              </span>
              <p className="text-[10px] font-bold text-violet-600 mt-0.5">{lead.score}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

function AuditCard({ visible }: { visible: number }) {
  return (
    <motion.div
      key="audit"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="landing-hero__scene-search w-full"
    >
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
          <Building2 size={15} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-zinc-900 truncate">Ink Factory Milano</p>
          <p className="text-[10px] text-zinc-400">Audit tecnico automatico</p>
        </div>
        <span className="ml-auto text-[9px] font-bold bg-zinc-900 text-white px-1.5 py-0.5 rounded-md">84 HOT</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {AUDIT_TAGS.map((tag, i) => (
          <motion.span
            key={tag.label}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={i < visible ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.28, ease: EASE }}
            className={`text-[9px] font-bold px-2 py-1 rounded-lg border ${
              tag.bad
                ? 'bg-red-50 text-red-700 border-red-100'
                : 'bg-emerald-50 text-emerald-700 border-emerald-100'
            }`}
          >
            {tag.bad && <AlertTriangle size={9} className="inline mr-0.5 -mt-px" />}
            {tag.label}
          </motion.span>
        ))}
      </div>
    </motion.div>
  )
}

function SourcesCard({ visible }: { visible: number }) {
  const icons = [MapPin, Building2, Mail, Phone]

  return (
    <motion.div
      key="sources"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="landing-hero__scene-search w-full"
    >
      <p className="text-xs sm:text-sm font-bold text-zinc-900 mb-2.5 tracking-tight">
        Dati verificati da ogni fonte
      </p>
      <div className="space-y-1.5">
        {SOURCE_ROWS.map((row, i) => {
          const Icon = icons[i] ?? Cloud
          return (
            <motion.div
              key={row.label}
              initial={{ opacity: 0, x: 16 }}
              animate={i < visible ? { opacity: 1, x: 0 } : { opacity: 0, x: 16 }}
              transition={{ duration: 0.36, ease: EASE }}
              className="landing-hero__source-row"
            >
              <div className="landing-hero__source-icon">
                <Icon size={13} strokeWidth={2.25} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] text-zinc-400 font-medium">{row.label}</p>
                <p className="text-[11px] font-semibold text-zinc-800 truncate">{row.value}</p>
              </div>
              {i === 0 && <FileSpreadsheet size={12} className="text-zinc-300 flex-shrink-0" />}
              {i === 1 && <Cloud size={12} className="text-zinc-300 flex-shrink-0" />}
              {i === 2 && <User size={12} className="text-zinc-300 flex-shrink-0" />}
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

function PitchCard({ text, showCursor }: { text: string; showCursor: boolean }) {
  return (
    <motion.div
      key="pitch"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="landing-hero__scene-search w-full"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg bg-fuchsia-100 text-fuchsia-700 flex items-center justify-center">
          <Mail size={15} />
        </div>
        <p className="text-xs font-bold text-zinc-900">Pitch commerciale</p>
        <Sparkles size={12} className="text-violet-500 ml-auto" />
      </div>
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 text-[10px] leading-relaxed text-zinc-600 min-h-[52px]">
        <span className="font-semibold text-zinc-800">Oggetto: </span>
        {text}
        <TypewriterCursor visible={showCursor} />
      </div>
      <motion.p
        className="mt-2 text-[9px] font-semibold text-violet-600"
        initial={{ opacity: 0 }}
        animate={{ opacity: text.length > 20 ? 1 : 0 }}
      >
        Pronto in &lt; 2 min · Copia o invia
      </motion.p>
    </motion.div>
  )
}

export default function HeroLushaVisual() {
  const reducedMotion = useReducedMotion()
  const [phase, setPhase] = useState<StoryPhase>('signal')

  const typingActive = phase === 'typing'
  const pitchActive = phase === 'pitch'
  const searchType = useTypewriter(SEARCH_QUERY, typingActive, reducedMotion ? 0 : 38, 0)
  const pitchType = useTypewriter(PITCH_TEXT, pitchActive, reducedMotion ? 0 : 32, 0)
  const typedQuery = searchType.text
  const typedPitch = pitchType.text

  const resultsVisible = useStaggerReveal(LEADS.length, phase === 'results', reducedMotion ? 0 : 280, 150)
  const auditVisible = useStaggerReveal(AUDIT_TAGS.length, phase === 'audit', reducedMotion ? 0 : 240, 120)
  const sourcesVisible = useStaggerReveal(SOURCE_ROWS.length, phase === 'sources', reducedMotion ? 0 : 300, 180)

  const layerShift = LAYER_SHIFT[phase]

  const goToPhase = (next: StoryPhase) => {
    setPhase(next)
  }

  // Advance from typing → results when query complete
  useEffect(() => {
    if (phase !== 'typing' || reducedMotion) return
    if (!searchType.complete) return
    const t = window.setTimeout(() => goToPhase('results'), 500)
    return () => window.clearTimeout(t)
  }, [phase, searchType.complete, reducedMotion])

  // Advance from pitch → signal when pitch complete
  useEffect(() => {
    if (phase !== 'pitch' || reducedMotion) return
    if (!pitchType.complete) return
    const t = window.setTimeout(() => goToPhase('signal'), 900)
    return () => window.clearTimeout(t)
  }, [phase, pitchType.complete, reducedMotion])

  // Phase timer for non-typing phases
  useEffect(() => {
    if (phase === 'typing' || phase === 'pitch') return
    const hold = reducedMotion ? 1800 : PHASE_HOLD[phase]
    const t = window.setTimeout(() => {
      const idx = PHASE_ORDER.indexOf(phase)
      const next = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]
      goToPhase(next)
    }, hold)
    return () => window.clearTimeout(t)
  }, [phase, reducedMotion])

  // Reduced motion: skip typing phases timing
  useEffect(() => {
    if (!reducedMotion || phase !== 'typing') return
    const t = window.setTimeout(() => goToPhase('results'), 400)
    return () => window.clearTimeout(t)
  }, [phase, reducedMotion])

  useEffect(() => {
    if (!reducedMotion || phase !== 'pitch') return
    const t = window.setTimeout(() => goToPhase('signal'), 1200)
    return () => window.clearTimeout(t)
  }, [phase, reducedMotion])

  const cardContent = useMemo(() => {
    switch (phase) {
      case 'signal':
        return <SignalsCard />
      case 'typing':
        return <TypingCard query={typedQuery || (reducedMotion ? SEARCH_QUERY : '')} showCursor={!reducedMotion && !searchType.complete} />
      case 'results':
        return <ResultsCard visible={reducedMotion ? LEADS.length : resultsVisible} />
      case 'audit':
        return <AuditCard visible={reducedMotion ? AUDIT_TAGS.length : auditVisible} />
      case 'sources':
        return <SourcesCard visible={reducedMotion ? SOURCE_ROWS.length : sourcesVisible} />
      case 'pitch':
        return (
          <PitchCard
            text={typedPitch || (reducedMotion ? PITCH_TEXT : '')}
            showCursor={!reducedMotion && !pitchType.complete}
          />
        )
      default:
        return null
    }
  }, [phase, typedQuery, typedPitch, searchType.complete, pitchType.complete, resultsVisible, auditVisible, sourcesVisible, reducedMotion])

  return (
    <div className="landing-hero__visual" aria-hidden="true">
      <motion.div
        className="landing-hero__stack"
        animate={reducedMotion ? {} : { y: [0, -6, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          className="landing-hero__layer landing-hero__layer--back"
          animate={{ x: layerShift.back[0], y: layerShift.back[1], rotate: layerShift.back[2] }}
          transition={{ duration: 0.85, ease: EASE }}
        >
          <div className="landing-hero__crosshair" aria-hidden="true" />
        </motion.div>
        <motion.div
          className="landing-hero__layer landing-hero__layer--mid"
          animate={{ x: layerShift.mid[0], y: layerShift.mid[1], rotate: layerShift.mid[2] }}
          transition={{ duration: 0.85, ease: EASE }}
        />

        <div className="landing-hero__layer landing-hero__layer--main">
          <div className="landing-hero__grid-lines" />

          <motion.div layout className="landing-hero__scene-card" transition={{ layout: { duration: 0.45, ease: EASE } }}>
            <AnimatePresence mode="wait">{cardContent}</AnimatePresence>
          </motion.div>
        </div>
      </motion.div>

      <motion.div
        className="landing-hero__integrations"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6, ease: EASE }}
      >
        <p className="text-[10px] sm:text-[11px] font-medium text-zinc-400 mb-2 text-center">
          Dati verificati da fonti italiane
        </p>
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          {[
            { icon: MapPin, label: 'Territorio' },
            { icon: Building2, label: 'PEC' },
            { icon: Search, label: 'Siti web' },
            { icon: Mail, label: 'Email DM' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="landing-hero__integration-pill">
              <Icon size={12} strokeWidth={2.25} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
