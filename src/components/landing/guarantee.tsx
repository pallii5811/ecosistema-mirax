'use client'

import { Shield, CreditCard, RotateCcw, ArrowRight, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'
import { LANDING } from '@/lib/landing-copy'
import '@/styles/landing-tokens.css'
import '@/styles/landing-sections.css'

const EASE = [0.22, 1, 0.36, 1] as const

const guarantees = [
  {
    icon: RotateCcw,
    title: '14 giorni soddisfatto o rimborsato',
    description: 'Non ti piace? Ti rimborsiamo tutto. Nessuna domanda, nessun modulo — basta un click.',
  },
  {
    icon: CreditCard,
    title: 'Cancella quando vuoi',
    description: 'Un click per disdire. Zero penali, zero vincoli contrattuali, zero sorprese.',
  },
  {
    icon: Shield,
    title: `${LANDING.freeCredits} crediti gratis`,
    description: `${LANDING.freeCredits} crediti gratuiti alla registrazione. Nessuna carta richiesta.`,
  },
]

const TRUST_ITEMS = ['Rimborso 14 giorni', 'Cancella in 1 click', 'Nessuna carta']

export function Guarantee() {
  return (
    <section className="landing-guarantee py-20 sm:py-28 lg:py-32 relative">
      <div className="landing-guarantee__top-fade" aria-hidden />
      <div className="landing-guarantee__glow" aria-hidden />
      <div className="landing-guarantee__dots" aria-hidden />

      <div className="relative max-w-5xl mx-auto px-5 sm:px-8">
        <motion.div
          className="text-center mb-12 sm:mb-14 max-w-xl mx-auto"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          <p className="landing-guarantee__eyebrow mb-4">Garanzia</p>
          <h2 className="landing-guarantee__headline text-3xl sm:text-4xl mb-4">
            Zero rischi. Garantito.
          </h2>
          <p className="landing-guarantee__sub text-base leading-relaxed">
            Se MIRAX non ti fa risparmiare tempo e chiudere più clienti, non paghi nulla.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {guarantees.map((g, i) => (
            <motion.div
              key={g.title}
              className="landing-guarantee__card p-6"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.07 * i, duration: 0.5, ease: EASE }}
            >
              <div className="landing-guarantee__icon flex items-center justify-center mb-5">
                <g.icon size={18} strokeWidth={2} />
              </div>
              <h3 className="landing-guarantee__card-title mb-2 leading-snug">{g.title}</h3>
              <p className="landing-guarantee__card-desc">{g.description}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="mt-10 sm:mt-12 text-center"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 0.5, ease: EASE }}
        >
          <div className="landing-guarantee__divider" />

          <div className="flex items-center justify-center gap-5 sm:gap-8 mb-8 flex-wrap">
            {TRUST_ITEMS.map((t) => (
              <div key={t} className="flex items-center gap-2.5">
                <span className="landing-guarantee__trust-check flex items-center justify-center">
                  <Check size={10} strokeWidth={3} />
                </span>
                <span className="landing-guarantee__trust-item">{t}</span>
              </div>
            ))}
          </div>

          <CtaLink>
            <span className="landing-cta-primary inline-flex items-center gap-2 text-white text-sm font-semibold px-8 py-3.5 rounded-full cursor-pointer">
              Inizia gratis — zero rischi
              <ArrowRight size={15} strokeWidth={2.25} />
            </span>
          </CtaLink>

          <p className="landing-guarantee__footnote mt-5">
            Un credito = un lead con telefono o email · Ricerche a vuoto gratis
          </p>
        </motion.div>
      </div>
    </section>
  )
}
