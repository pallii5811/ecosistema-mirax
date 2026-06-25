'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Radar, Sparkles, BarChart3, Send, Phone, Mail, Building2, Kanban, MessageSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import HeroMockupSidebar, { HERO_DEMO_LEADS } from '@/components/landing/hero/HeroMockupSidebar'
import HeroDeviceFrame from '@/components/landing/hero/HeroDeviceFrame'
import { SearchPhase, DetailPhase, PitchPhase } from '@/components/landing/hero/HeroDashboardMockup'
import '@/styles/landing-product-showcase.css'
import { LANDING } from '@/lib/landing-copy'

const EASE = [0.22, 1, 0.36, 1] as const
const STEP_MS = 8000

const TAB_URLS: Record<string, string> = {
  search: 'miraxgroup.it/dashboard',
  audit: 'miraxgroup.it/lead/techlane',
  pitch: 'miraxgroup.it/outreach/pitch',
  score: 'miraxgroup.it/dashboard?sort=score',
  contact: 'miraxgroup.it/lead/contatti',
  outreach: 'miraxgroup.it/dashboard/outreach',
}

const MODULES: {
  id: string
  label: string
  icon: LucideIcon
  headline: string
  tagline: string
}[] = [
  {
    id: 'search',
    label: 'Ricerca AI',
    icon: Search,
    headline: 'Scrivi in italiano. Trova in secondi.',
    tagline: `${LANDING.discovery.engineShort}, 16+ filtri tecnici e lead mentre la scansione è in corso.`,
  },
  {
    id: 'audit',
    label: 'Audit Tecnico',
    icon: Radar,
    headline: 'Radiografia digitale su ogni sito.',
    tagline: 'SEO, Pixel, GTM, SSL e social — i gap che aprono la conversazione giusta.',
  },
  {
    id: 'pitch',
    label: 'Pitch AI',
    icon: Sparkles,
    headline: "Il messaggio che sembra scritto a mano.",
    tagline: 'Oggetto, corpo e CTA sui problemi reali del sito. WhatsApp, email o LinkedIn.',
  },
  {
    id: 'outreach',
    label: 'Centro Outreach',
    icon: MessageSquare,
    headline: 'Contatta con metodo, non a caso.',
    tagline: 'Coda prioritizzata, log di ogni invio, limite giornaliero, anti-duplicato 7 giorni e approvazione manuale.',
  },
  {
    id: 'score',
    label: 'Score AI',
    icon: BarChart3,
    headline: 'Priorità chiare, zero intuizioni.',
    tagline: 'Score 0–100 sulla gravità dei problemi e sull\'opportunità commerciale.',
  },
  {
    id: 'contact',
    label: 'Contatti Diretti',
    icon: Send,
    headline: 'Parli con chi decide.',
    tagline: 'Telefono, email e PEC quando disponibili — un credito solo se c\'è un contatto.',
  },
]

function ProductMockupShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-50/30">
        <HeroMockupSidebar />
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden scroll-smooth [scrollbar-width:thin]">
          {children}
        </div>
      </div>
    </div>
  )
}

function ScoreMockup() {
  const leads = [...HERO_DEMO_LEADS].sort((a, b) => b.score - a.score).slice(0, 5)
  return (
    <ProductMockupShell>
      <div className="p-3 sm:p-4 h-full">
        <div className="flex items-center gap-1.5 mb-3">
          <BarChart3 size={14} className="text-violet-600" />
          <h3 className="text-[13px] font-bold text-slate-800">Lead ordinati per score</h3>
        </div>
        <div className="space-y-2">
          {leads.map((lead) => (
            <div key={lead.name} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <div className="text-sm font-bold text-slate-900 w-8 text-center tabular-nums">{lead.score}</div>
              <div className={`text-[7px] font-bold px-1.5 py-0.5 rounded-md ${lead.tier === 'HOT' ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-600'}`}>
                {lead.tier}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-slate-900 truncate">{lead.name}</div>
                <div className="text-[9px] text-slate-500">{lead.citta} · {lead.opportunita}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ProductMockupShell>
  )
}

function ContactMockup() {
  const lead = HERO_DEMO_LEADS[0]
  return (
    <ProductMockupShell>
      <div className="p-3 sm:p-4 h-full">
        <div className="flex items-center gap-1.5 mb-3">
          <Send size={14} className="text-violet-600" />
          <h3 className="text-[13px] font-bold text-slate-800">Contatti diretti verificati</h3>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">IF</div>
            <div>
              <div className="text-sm font-bold text-slate-900">{lead.name}</div>
              <div className="text-[10px] text-slate-500">Titolare · Decision maker</div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 flex items-center gap-2">
            <Phone size={14} className="text-emerald-600" />
            <div>
              <div className="text-[9px] font-semibold text-emerald-700 uppercase">Mobile titolare</div>
              <div className="text-[11px] font-bold text-emerald-900">{lead.mobile}</div>
            </div>
          </div>
          <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2.5 flex items-center gap-2">
            <Mail size={14} className="text-violet-600" />
            <div className="min-w-0">
              <div className="text-[9px] font-semibold text-violet-700 uppercase">Email diretta</div>
              <div className="text-[11px] font-bold text-violet-900 truncate">{lead.email}</div>
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 flex items-center gap-2">
            <Building2 size={14} className="text-slate-500" />
            <div>
              <div className="text-[9px] font-semibold text-slate-500 uppercase">PEC azienda</div>
              <div className="text-[11px] font-bold text-slate-800">info@inkfactory.it</div>
            </div>
          </div>
        </div>
      </div>
    </ProductMockupShell>
  )
}

function OutreachMockup() {
  const queue = [
    { name: 'Ink Factory Milano', issue: 'NO PIXEL', channel: 'WhatsApp', status: 'Pronto' },
    { name: 'Studio Bianchi', issue: 'SEO −12', channel: 'Email', status: 'In coda' },
    { name: 'Palestra FitZone', issue: 'NO INSTAGRAM', channel: 'LinkedIn', status: 'In coda' },
  ]

  return (
    <ProductMockupShell>
      <div className="p-3 sm:p-4 h-full">
        <div className="flex items-center gap-1.5 mb-3">
          <MessageSquare size={14} className="text-violet-600" />
          <h3 className="text-[13px] font-bold text-slate-800">Centro Outreach</h3>
        </div>
        <div className="space-y-2 mb-3">
          {queue.map((item, i) => (
            <div
              key={item.name}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[10px] ${
                i === 0 ? 'border-violet-200 bg-violet-50/80' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-900 truncate">{item.name}</div>
                <div className="text-slate-500">{item.issue} · {item.channel}</div>
              </div>
              <span className={`font-bold px-1.5 py-0.5 rounded-md ${i === 0 ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
          <Kanban size={14} className="text-violet-600" />
          <div className="text-[10px] text-slate-600">
            <span className="font-bold text-slate-800">Pipeline: </span>
            Nuovo → Contattato → Meeting → Vinto
          </div>
        </div>
      </div>
    </ProductMockupShell>
  )
}

const mockups: Record<string, () => React.ReactNode> = {
  search: () => (
    <ProductMockupShell>
      <SearchPhase />
    </ProductMockupShell>
  ),
  audit: () => (
    <ProductMockupShell>
      <DetailPhase />
    </ProductMockupShell>
  ),
  pitch: () => (
    <ProductMockupShell>
      <PitchPhase />
    </ProductMockupShell>
  ),
  outreach: OutreachMockup,
  score: ScoreMockup,
  contact: ContactMockup,
}

export default function ProductShowcase() {
  const [activeIdx, setActiveIdx] = useState(0)
  const [progress, setProgress] = useState(0)

  const mod = MODULES[activeIdx]
  const MockupComponent = mockups[mod.id]

  useEffect(() => {
    setProgress(0)
    const start = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / STEP_MS)
      setProgress(p)
      if (p < 1) frame = requestAnimationFrame(tick)
      else setActiveIdx((i) => (i + 1) % MODULES.length)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [activeIdx])

  return (
    <section id="features" className="landing-product py-20 sm:py-28 lg:py-32 overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-hidden">
        {/* Mobile pills */}
        <div className="lg:hidden landing-product__mobile-scroll -mx-1 px-1">
          {MODULES.map((m, i) => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={`landing-product__mobile-pill flex items-center gap-1.5 ${i === activeIdx ? 'landing-product__mobile-pill--active' : ''}`}
              >
                <Icon size={12} />
                {m.label}
              </button>
            )
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.65, ease: EASE }}
          className="landing-product__split"
        >
          {/* Sinistra — lista moduli (Glean enterprise style) */}
          <div className="landing-product__features hidden lg:block">
            <p className="landing-product__label">Piattaforma</p>
            {MODULES.map((m, i) => {
              const Icon = m.icon
              const isActive = i === activeIdx
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className={`landing-product__feature ${isActive ? 'landing-product__feature--active' : 'landing-product__feature--inactive'}`}
                >
                  <div className="landing-product__feature-inner">
                    <div className="landing-product__feature-icon">
                      <Icon size={18} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="landing-product__feature-title">{m.label}</div>
                      <p className="landing-product__feature-desc">{m.tagline}</p>
                      {isActive && (
                        <div className="landing-product__feature-progress">
                          <motion.span
                            style={{ width: `${progress * 100}%` }}
                            className="block h-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Destra — headline + mockup su stage */}
          <div className="landing-product__visual">
            <div className="landing-product__stage-bg" />
            <div className="landing-product__stage-dots" />

            <div className="landing-product__stage-content">
              <AnimatePresence mode="wait">
                <motion.h3
                  key={mod.id + '-headline'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="landing-product__stage-headline"
                >
                  {mod.headline}
                </motion.h3>
              </AnimatePresence>

              {/* Mobile tagline */}
              <p className="lg:hidden text-sm text-zinc-500 leading-relaxed -mt-3 mb-5 max-w-full">
                {mod.tagline}
              </p>

              <div className="landing-product__stage-mockup">
                <HeroDeviceFrame
                  url={TAB_URLS[mod.id]}
                  className="w-full"
                  shellClassName="landing-product__device-shell"
                  uiClassName="landing-product__mockup-ui"
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={mod.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="landing-product__mockup-panel"
                    >
                      <MockupComponent />
                    </motion.div>
                  </AnimatePresence>
                </HeroDeviceFrame>
              </div>

              {/* Mobile progress */}
              <div className="lg:hidden mt-4 h-0.5 rounded-full bg-zinc-200 overflow-hidden max-w-xs mx-auto w-full">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${progress * 100}%`, background: 'linear-gradient(90deg,#7c3aed,#a855f7)' }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
