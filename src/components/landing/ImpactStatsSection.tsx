'use client'

import { motion } from 'framer-motion'
import { Search, Sparkles, Clock, Target, Kanban, Mail, Shield } from 'lucide-react'
import { LANDING } from '@/lib/landing-copy'
import '@/styles/landing-impact.css'

const EASE = [0.22, 1, 0.36, 1] as const

const METRICS = [
  { value: '< 2 min', label: 'Al pitch pronto', icon: Clock },
  { value: '1:1', label: 'Credito = lead', icon: Target },
  { value: '7 gg', label: 'Anti-duplicato', icon: Shield },
  { value: 'CSV', label: 'HubSpot · API', icon: Mail },
]

const FLOW_PILLS = [...LANDING.cycle.steps]

const fade = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.6, ease: EASE },
}

export default function ImpactStatsSection() {
  return (
    <section className="landing-impact relative py-20 sm:py-24 lg:py-28 overflow-x-clip w-full border-t border-zinc-200/60">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...fade} className="mb-8 sm:mb-12 max-w-4xl">
          <h2 className="landing-impact__headline text-2xl sm:text-3xl lg:text-[2.1rem] leading-snug tracking-tight">
            <strong>La macchina commerciale completa per l&apos;Italia.</strong>{' '}
            <span>{LANDING.discovery.flow} — ricerca, scoring, outreach, sequenze e pipeline in un unico flusso.</span>
          </h2>
        </motion.div>

        <div className="landing-impact__bento space-y-4 sm:space-y-5">
          <div className="landing-impact__bento-row">
            <motion.article
              {...fade}
              transition={{ ...fade.transition, delay: 0.05 }}
              className="landing-impact__bento-card landing-impact__span-7 flex flex-col min-h-[360px] sm:min-h-[400px] lg:min-h-[420px]"
            >
              <div className="p-6 sm:p-8 pb-4">
                <h3 className="landing-impact__card-title max-w-lg">
                  <strong>{LANDING.discovery.findTitle}</strong>{' '}
                  <span>Scrivi in italiano, filtra per Pixel, GTM, SEO e social — copertura nazionale on-demand.</span>
                </h3>
                <div className="landing-impact__stat landing-impact__stat--hero text-5xl sm:text-6xl font-bold text-zinc-900 mt-5">
                  16<span className="text-violet-600">+</span>
                  <span className="block text-sm sm:text-base font-semibold text-zinc-500 mt-2">filtri tecnici</span>
                </div>
              </div>
              <div className="landing-impact__texture-coral flex-1 relative mt-auto min-h-[180px] sm:min-h-[220px] px-6 sm:px-8 pb-8 flex items-end">
                <div className="landing-impact__search-bar w-full max-w-md mx-auto flex items-center gap-2 px-4 py-3">
                  <Search size={16} className="text-violet-500 flex-shrink-0" />
                  <span className="text-sm text-zinc-500 flex-1 truncate">tatuatori Milano senza Instagram</span>
                  <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-1 rounded-full hidden sm:inline">AI</span>
                </div>
              </div>
            </motion.article>

            <motion.article
              {...fade}
              transition={{ ...fade.transition, delay: 0.1 }}
              className="landing-impact__bento-card landing-impact__span-5 flex flex-col min-h-[320px] sm:min-h-[400px] lg:min-h-[420px]"
            >
              <div className="p-6 sm:p-8 pb-4">
                <h3 className="landing-impact__card-title max-w-sm">
                  <strong>Qualifica i lead.</strong>{' '}
                  <span>Score 0–100 su gravità dei problemi e opportunità commerciale.</span>
                </h3>
                <div className="landing-impact__stat text-4xl sm:text-5xl font-bold text-zinc-900 mt-5">
                  0<span className="text-violet-600">–</span>100
                  <span className="block text-sm font-semibold text-zinc-500 mt-2">score opportunità</span>
                </div>
              </div>
              <div className="landing-impact__texture-mint flex-1 p-6 sm:p-8 pt-2 space-y-2">
                {[
                  { step: '1. Filtra', text: 'senza Pixel · errori SEO' },
                  { step: '2. Score', text: 'Ink Factory · 84 HOT' },
                  { step: '3. Pitch', text: 'AI sui problemi reali' },
                ].map((item) => (
                  <div key={item.step} className="landing-impact__flow-step flex items-center justify-between gap-2">
                    <span className="text-violet-600">{item.step}</span>
                    <span className="text-zinc-500 truncate text-right">{item.text}</span>
                  </div>
                ))}
              </div>
            </motion.article>
          </div>

          <div className="landing-impact__bento-row">
            <motion.article
              {...fade}
              transition={{ ...fade.transition, delay: 0.15 }}
              className="landing-impact__bento-card landing-impact__span-4 flex flex-col min-h-[260px]"
            >
              <div className="p-6 sm:p-7 pb-4">
                <h3 className="landing-impact__card-title">
                  <strong>Capisci il contesto.</strong>{' '}
                  <span>Audit SEO, pixel, GTM e social per ogni lead.</span>
                </h3>
              </div>
              <div className="landing-impact__dots flex-1 px-6 pb-6 pt-2">
                <div className="landing-impact__audit-bubble p-3 space-y-2 max-w-[240px]">
                  <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Analisi automatica</div>
                  <div className="text-[11px] font-semibold text-zinc-900">Ink Factory · Milano</div>
                  <div className="flex flex-wrap gap-1">
                    {['NO PIXEL', 'NO GTM'].map((t) => (
                      <span key={t} className="text-[7px] font-bold bg-red-50 text-red-700 border border-red-100 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-violet-600 font-medium">
                    <Sparkles size={10} /> Pitch suggerito
                  </div>
                </div>
              </div>
            </motion.article>

            <motion.article
              {...fade}
              transition={{ ...fade.transition, delay: 0.2 }}
              className="landing-impact__bento-card landing-impact__span-8 flex flex-col min-h-[260px] sm:min-h-[280px]"
            >
              <div className="p-6 sm:p-7 pb-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <h3 className="landing-impact__card-title max-w-xl">
                  <strong>Chiudi il deal.</strong>{' '}
                  <span>Centro Outreach con log audit, pipeline kanban e sequenze email.</span>
                </h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Kanban size={16} className="text-violet-600" />
                  <span className="landing-impact__stat text-3xl font-bold text-zinc-900">E2E</span>
                </div>
              </div>
              <div className="landing-impact__texture-violet flex-1 relative px-4 sm:px-6 pb-5 pt-2 overflow-hidden">
                <div className="flex flex-wrap justify-center gap-2 mb-4 max-w-lg mx-auto">
                  {FLOW_PILLS.map((name) => (
                    <span key={name} className="landing-impact__agency-pill">{name}</span>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl mx-auto">
                  {METRICS.map((m) => {
                    const Icon = m.icon
                    return (
                      <div key={m.label} className="landing-impact__metric-chip text-center sm:text-left">
                        <Icon size={12} className="text-violet-600 mx-auto sm:mx-0 mb-1" />
                        <div className="text-sm font-bold text-zinc-900 tabular-nums">{m.value}</div>
                        <div className="text-[10px] text-zinc-500">{m.label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </motion.article>
          </div>
        </div>
      </div>
    </section>
  )
}
