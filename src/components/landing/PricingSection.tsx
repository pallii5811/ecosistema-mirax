'use client'

import { Check, Shield } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'
import Link from 'next/link'
import { LANDING } from '@/lib/landing-copy'

type Plan = {
  name: string
  price: string
  period: string
  desc: string
  features: string[]
  cta: string
  href?: string
  note: string
  highlight: boolean
  badge?: string
}

const plans: Plan[] = [
  {
    name: 'Esplora',
    price: '€0',
    period: 'per sempre',
    desc: 'Prova MIRAX con tutte le funzionalità della piattaforma.',
    features: [
      `${LANDING.freeCredits} crediti una tantum`,
      'Ricerca AI + 16 filtri tecnici',
      'Audit, score e pitch AI',
      'Centro Outreach e pipeline',
      'Export CSV',
      'Nessuna carta richiesta',
    ],
    cta: 'Inizia Gratis',
    href: '/dashboard',
    note: 'Un credito = un lead con telefono o email',
    highlight: false,
  },
  {
    name: 'Starter',
    price: '€49',
    period: '/ mese',
    desc: 'Per freelance e consulenti che prospectano ogni settimana.',
    features: [
      '1.200 crediti / mese',
      'Tutte le funzionalità Esplora',
      'Liste, ambienti e bulk save',
      'Sync HubSpot e webhook',
      'Smart Insights e hotlist',
      'Supporto email prioritario',
    ],
    cta: 'Inizia Ora',
    href: '/dashboard/billing',
    note: 'Ideale per volumi regolari',
    highlight: false,
    badge: 'Popolare',
  },
  {
    name: 'PRO',
    price: '€99',
    period: '/ mese',
    desc: 'Per agency che chiudono decine di deal al mese.',
    highlight: true,
    badge: 'Più Scelto',
    features: [
      '3.000 crediti / mese',
      'Tutto dello Starter incluso',
      'Sequenze email con invio automatico',
      'Ricerca Ambiente (espansione AI)',
      'Campaign Agent in outreach',
      'Supporto prioritario',
    ],
    cta: 'Inizia Ora',
    href: '/dashboard/billing',
    note: 'Il miglior rapporto volume/prezzo',
  },
  {
    name: 'Agency',
    price: '€249',
    period: '/ mese',
    desc: 'Per team con volumi enterprise e automazioni.',
    features: [
      '10.000 crediti / mese',
      'Tutto del PRO incluso',
      'API REST + chiavi API',
      'Webhook personalizzato',
      'Sync CRM bulk avanzato',
      'Supporto dedicato',
    ],
    cta: 'Parla con Noi',
    href: '/dashboard/billing',
    note: 'Per chi scala l\'outbound',
    highlight: false,
  },
]

export default function PricingSection() {
  return (
    <section id="pricing" className="bg-white py-20 sm:py-28 lg:py-32 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-14">
          <p className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest mb-4">
            Prezzi
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight leading-tight mb-4">
            Paga per i lead, non per le funzioni bloccate.
          </h2>
          <p className="text-base text-zinc-400 max-w-xl mx-auto">
            Tutti i piani includono ricerca, audit, pitch, outreach e pipeline. La differenza è il volume di crediti.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {plans.map((p, idx) => {
            const isPro = p.highlight
            return (
              <motion.div
                key={p.name}
                className={`relative rounded-2xl flex flex-col overflow-hidden ${
                  isPro
                    ? 'bg-violet-600 border border-violet-500'
                    : 'bg-white border border-zinc-200 hover:border-zinc-300 hover:shadow-sm transition-all duration-200'
                }`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.07, duration: 0.4 }}
              >
                {p.badge && (
                  <div className={`absolute top-4 right-4 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    isPro
                      ? 'bg-white/15 text-white/80'
                      : 'bg-violet-50 text-violet-600 border border-violet-100'
                  }`}>
                    {p.badge}
                  </div>
                )}

                <div className="p-6 flex-1 flex flex-col">
                  <div className={`text-[11px] font-bold uppercase tracking-widest mb-4 ${
                    isPro ? 'text-white/50' : 'text-zinc-400'
                  }`}>
                    {p.name}
                  </div>

                  <div className="mb-2">
                    <span className={`text-4xl font-bold tracking-tight ${isPro ? 'text-white' : 'text-zinc-900'}`}>
                      {p.price}
                    </span>
                    <span className={`text-sm ml-1 ${isPro ? 'text-white/50' : 'text-zinc-400'}`}>
                      {p.period}
                    </span>
                  </div>
                  <p className={`text-sm mb-6 leading-relaxed ${isPro ? 'text-white/60' : 'text-zinc-400'}`}>
                    {p.desc}
                  </p>

                  <div className={`h-px mb-6 ${isPro ? 'bg-white/10' : 'bg-zinc-100'}`} />

                  <div className="flex-1 space-y-3">
                    {p.features.map((f) => (
                      <div key={f} className="flex items-start gap-2.5">
                        <div className={`w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          isPro ? 'bg-white/15' : 'bg-violet-50'
                        }`}>
                          <Check size={9} className={isPro ? 'text-white' : 'text-violet-600'} strokeWidth={3} />
                        </div>
                        <span className={`text-sm leading-relaxed ${isPro ? 'text-white/70' : 'text-zinc-600'}`}>
                          {f}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8">
                    {p.href ? (
                      <Link
                        href={p.href}
                        className={`block text-center py-3 rounded-xl text-sm font-semibold transition-all duration-200 no-underline ${
                          isPro
                            ? 'bg-white text-violet-600 hover:bg-violet-50'
                            : 'border border-zinc-200 text-zinc-700 hover:border-violet-300 hover:text-violet-600'
                        }`}
                      >
                        {p.cta}
                      </Link>
                    ) : (
                      <CtaLink>
                        <span className={`block text-center py-3 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 ${
                          isPro
                            ? 'bg-white text-violet-600 hover:bg-violet-50'
                            : 'bg-zinc-900 text-white hover:bg-zinc-800'
                        }`}>
                          {p.cta}
                        </span>
                      </CtaLink>
                    )}
                    <p className={`text-[10px] text-center mt-3 ${isPro ? 'text-white/30' : 'text-zinc-400'}`}>
                      {p.note}
                    </p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>

        <motion.div
          className="flex items-center justify-center gap-3 bg-zinc-50 border border-zinc-200 rounded-2xl px-6 py-4 max-w-md mx-auto"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.35 }}
        >
          <Shield size={16} className="text-zinc-400 flex-shrink-0" />
          <span className="text-sm text-zinc-600">
            <strong className="text-zinc-800">Garanzia 14 giorni</strong> soddisfatti o rimborsati. Nessun vincolo.
          </span>
        </motion.div>
      </div>
    </section>
  )
}
