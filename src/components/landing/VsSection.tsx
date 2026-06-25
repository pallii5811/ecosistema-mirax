'use client'

import { ArrowRight, Check, X } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'
import { LANDING } from '@/lib/landing-copy'
import '@/styles/landing-tokens.css'
import '@/styles/landing-sections.css'

const EASE = [0.22, 1, 0.36, 1] as const

const rows = [
  { label: 'Qualità dei lead', cold: 'Lista acquistata, dati vecchi', mirax: 'Profilati con audit in tempo reale' },
  { label: 'Tempo per 10 lead', cold: '3-4 ore ricerca manuale', mirax: 'Meno di 2 minuti' },
  { label: 'Conosci il problema?', cold: 'No — parli al buio', mirax: 'SEO, pixel, DMARC, velocità' },
  { label: 'Pitch personalizzato', cold: 'Lo scrivi tu da zero', mirax: "Generato dall'AI sui gap reali" },
  { label: 'Contatto diretto', cold: 'Spesso centralino', mirax: 'Mobile e email quando disponibili' },
  { label: 'Dopo il primo messaggio', cold: 'Nessun tracciamento', mirax: 'Outreach log + pipeline CRM', highlight: true },
]

export function VsSection() {
  return (
    <section className="landing-vs py-20 sm:py-28 lg:py-32">
      <div className="max-w-5xl mx-auto px-5 sm:px-8">
        <motion.div
          className="mb-12 sm:mb-16 max-w-2xl"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          <p className="landing-vs__eyebrow mb-4">Il confronto</p>
          <h2 className="landing-vs__headline text-3xl sm:text-4xl mb-4">
            Perché le liste fredde non funzionano più.
          </h2>
          <p className="landing-vs__sub text-base leading-relaxed">
            MIRAX non ti vende un CSV. Ti dà contesto, priorità e un messaggio che apre la conversazione.
          </p>
        </motion.div>

        <motion.div
          className="landing-vs__grid"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          {/* Lista fredda — card secondaria */}
          <div className="landing-vs__cold-card">
            <div className="landing-vs__cold-header">
              <span className="landing-vs__icon-cold flex items-center justify-center">
                <X size={11} strokeWidth={2.5} />
              </span>
              <span className="landing-vs__cold-badge">Lista fredda</span>
            </div>
            <div>
              {rows.map((row) => (
                <div key={row.label} className="landing-vs__row">
                  <div className="flex-1 min-w-0">
                    <div className="landing-vs__row-label">{row.label}</div>
                    <p className="landing-vs__cold-text">{row.cold}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* MIRAX — card primaria elevata */}
          <div className="landing-vs__mirax-card">
            <div className="landing-vs__mirax-header">
              <div className="flex items-center gap-2.5">
                <span className="landing-vs__icon-mirax flex items-center justify-center">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="landing-vs__mirax-badge">MIRAX</span>
              </div>
              <span className="landing-vs__mirax-pill">Consigliato</span>
            </div>
            <div>
              {rows.map((row) => (
                <div key={row.label} className="landing-vs__row">
                  <span className="landing-vs__icon-mirax flex items-center justify-center">
                    <Check size={11} strokeWidth={3} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="landing-vs__row-label">{row.label}</div>
                    <p className={`landing-vs__mirax-text ${row.highlight ? 'landing-vs__mirax-text--highlight' : ''}`}>
                      {row.mirax}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          className="landing-vs__footer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15, duration: 0.5, ease: EASE }}
        >
          <p className="landing-vs__sub text-sm max-w-md leading-relaxed">
            Non compri contatti. Trovi <strong className="text-zinc-800 font-semibold">opportunità misurabili</strong> con il messaggio giusto per aprire la conversazione.
          </p>

          <CtaLink>
            <span className="landing-cta-primary inline-flex items-center gap-2 text-white text-sm font-semibold px-7 py-3.5 rounded-full cursor-pointer whitespace-nowrap">
              Prova con {LANDING.freeCreditsLabel}
              <ArrowRight size={15} strokeWidth={2.25} />
            </span>
          </CtaLink>
        </motion.div>
      </div>
    </section>
  )
}
