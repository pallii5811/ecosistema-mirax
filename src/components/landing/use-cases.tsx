'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Megaphone,
  Code,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Mail,
  Sparkles,
  Instagram,
  Building2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import '@/styles/landing-use-cases.css'

const EASE = [0.22, 1, 0.36, 1] as const
const STEP_MS = 7000

type Persona = {
  id: string
  label: string
  description: string
  icon: LucideIcon
  badge: string
  accent: string
}

const PERSONAS: Persona[] = [
  {
    id: 'agency',
    label: 'Web Agency & SEO',
    description:
      'Trova aziende locali con siti lenti o mal posizionati. Report istantanei su errori critici per vendere restyling completi.',
    icon: Search,
    badge: 'SEO Audit',
    accent: '#0066FF',
  },
  {
    id: 'smm',
    label: 'Social Media Manager',
    description:
      'Filtra ristoranti, palestre e retail senza Meta Pixel o Instagram attivo. Pitch AI pronto per vendere social e ADS.',
    icon: Megaphone,
    badge: 'Social Gap',
    accent: '#FF3366',
  },
  {
    id: 'dev',
    label: 'Software House & Dev',
    description:
      'Individua PMI B2B strutturate per vendere CRM, gestionali o e-commerce. PEC, telefono e contatti del titolare quando disponibili.',
    icon: Code,
    badge: 'Lead Data',
    accent: '#FFB800',
  },
]

function AgencyMockup() {
  const rows = [
    { finding: 'Meta description assente', severity: 'warn' },
    { finding: 'Core Web Vitals scarsi', severity: 'warn' },
    { finding: 'Nessun Pixel Meta', severity: 'warn' },
    { finding: 'Pitch AI generato', severity: 'ok' },
  ] as const

  return (
    <div className="landing-usecases__mockup-card">
      <div className="landing-usecases__mockup-header">
        <span className="landing-usecases__mockup-title">Audit SEO — Studio Bianchi</span>
        <span className="landing-usecases__mockup-badge">SEO Audit</span>
      </div>
      <div className="landing-usecases__mockup-body">
        <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Priorità commerciale</div>
        {rows.map((row) => (
          <div key={row.finding} className="landing-usecases__row">
            {row.severity === 'ok' ? (
              <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            )}
            <span className="text-zinc-700 font-medium flex-1">{row.finding}</span>
            <span className={`text-[10px] font-bold ${row.severity === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>
              {row.severity === 'ok' ? 'Pronto' : 'Critico'}
            </span>
          </div>
        ))}
        <div className="mt-3 rounded-xl bg-violet-600 text-white text-xs font-bold py-2.5 flex items-center justify-center gap-1.5">
          <Sparkles size={13} /> Pitch pronto da inviare
        </div>
      </div>
    </div>
  )
}

function SocialMockup() {
  const rows = [
    { label: 'Instagram', value: 'Non collegato', bad: true },
    { label: 'Meta Pixel', value: 'Assente', bad: true },
    { label: 'Campagne ADS', value: 'Non tracciate', bad: true },
    { label: 'Opportunità', value: 'Gestione social', bad: false },
  ]

  return (
    <div className="landing-usecases__mockup-card">
      <div className="landing-usecases__mockup-header">
        <span className="landing-usecases__mockup-title">Social Gap — Palestra FitZone</span>
        <span className="landing-usecases__mockup-badge">Social Gap</span>
      </div>
      <div className="landing-usecases__mockup-body">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center">
            <Instagram size={16} />
          </div>
          <div>
            <div className="text-xs font-bold text-zinc-900">Analisi canali social</div>
            <div className="text-[10px] text-zinc-400">Milano · Retail</div>
          </div>
        </div>
        {rows.map((row) => (
          <div key={row.label} className="landing-usecases__row">
            <span className="text-zinc-500 w-24 flex-shrink-0">{row.label}</span>
            <span className={`font-semibold flex-1 ${row.bad ? 'text-rose-600' : 'text-violet-600'}`}>{row.value}</span>
          </div>
        ))}
        <div className="mt-3 rounded-xl bg-rose-500 text-white text-xs font-bold py-2.5 flex items-center justify-center gap-1.5">
          <Sparkles size={13} /> Pitch social pronto
        </div>
      </div>
    </div>
  )
}

function DevMockup() {
  const rows = [
    { label: 'Azienda', value: 'Techlane SRL' },
    { label: 'PEC', value: 'Verificata ✓' },
    { label: 'Mobile titolare', value: '+39 3** *** **42' },
    { label: 'Email DM', value: 'marco.rossi@techlane.it' },
  ]

  return (
    <div className="landing-usecases__mockup-card">
      <div className="landing-usecases__mockup-header">
        <span className="landing-usecases__mockup-title">Lead Data — Techlane SRL</span>
        <span className="landing-usecases__mockup-badge">Lead Data</span>
      </div>
      <div className="landing-usecases__mockup-body">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Building2 size={16} />
          </div>
          <div>
            <div className="text-xs font-bold text-zinc-900">Contatti decision maker</div>
            <div className="text-[10px] text-zinc-400">B2B · 12–49 dipendenti</div>
          </div>
        </div>
        {rows.map((row) => (
          <div key={row.label} className="landing-usecases__row">
            <span className="text-zinc-500 w-28 flex-shrink-0">{row.label}</span>
            <span className="font-semibold text-zinc-800 flex-1">{row.value}</span>
          </div>
        ))}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 flex items-center gap-1.5 text-[10px] text-zinc-600">
            <Phone size={11} className="text-emerald-500" /> Cellulare
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 flex items-center gap-1.5 text-[10px] text-zinc-600">
            <Mail size={11} className="text-blue-500" /> Email DM
          </div>
        </div>
      </div>
    </div>
  )
}

const MOCKUPS = {
  agency: AgencyMockup,
  smm: SocialMockup,
  dev: DevMockup,
} as const

export function UseCases() {
  const [activeIdx, setActiveIdx] = useState(0)
  const persona = PERSONAS[activeIdx]
  const Mockup = MOCKUPS[persona.id as keyof typeof MOCKUPS]

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveIdx((i) => (i + 1) % PERSONAS.length)
    }, STEP_MS)
    return () => window.clearTimeout(timer)
  }, [activeIdx])

  return (
    <section id="use-cases" className="landing-usecases border-t border-zinc-200/60 py-20 sm:py-28 lg:py-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="landing-usecases__headline text-center text-2xl sm:text-3xl lg:text-[2.35rem] font-bold text-zinc-900 mb-14 sm:mb-16 lg:mb-20 max-w-3xl mx-auto"
        >
          Per chi è stato creato MIRAX
        </motion.h2>

        {/* Mobile pills */}
        <div className="md:hidden flex gap-2 overflow-x-auto -mx-4 px-4 mb-8 scrollbar-none">
          {PERSONAS.map((p, i) => {
            const Icon = p.icon
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={`landing-usecases__mobile-pill flex items-center gap-1.5 flex-shrink-0 ${i === activeIdx ? 'landing-usecases__mobile-pill--active' : ''}`}
              >
                <Icon size={12} />
                {p.label.split(' ')[0]}
              </button>
            )
          })}
        </div>

        <div className="landing-usecases__layout">
          {/* Stepper — sinistra (tablet+) */}
          <div className="landing-usecases__stepper-col hidden md:block">
            <div className="landing-usecases__stepper">
            <div className="landing-usecases__timeline" aria-hidden="true" />
            {PERSONAS.map((p, i) => {
              const isActive = i === activeIdx
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className={`landing-usecases__step ${isActive ? 'landing-usecases__step--active' : ''}`}
                >
                  <span className={`landing-usecases__dot ${isActive ? 'landing-usecases__dot--active' : ''}`} />
                  <span className="landing-usecases__step-label">{p.label}</span>
                  <AnimatePresence initial={false}>
                    {isActive && (
                      <motion.p
                        key={p.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className="landing-usecases__step-desc overflow-hidden"
                      >
                        {p.description}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </button>
              )
            })}
            </div>
          </div>

          {/* Mockup — destra */}
          <div className="landing-usecases__stage-col">
          <div className="landing-usecases__stage">
            <div className="landing-usecases__stage-dots" />
            <div className="landing-usecases__mockup-wrap">
              <AnimatePresence mode="wait">
                <motion.div
                  key={persona.id}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  className="w-full flex justify-center"
                >
                  <Mockup />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          </div>
        </div>

        {/* Mobile description */}
        <p className="md:hidden mt-8 text-center text-sm text-zinc-500 leading-relaxed max-w-md mx-auto">
          {persona.description}
        </p>
      </div>
    </section>
  )
}
