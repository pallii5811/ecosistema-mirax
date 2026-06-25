'use client'

import { ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'
import HeroLushaVisual from '@/components/landing/hero/HeroLushaVisual'
import { LANDING } from '@/lib/landing-copy'
import '@/styles/landing-hero.css'

const EASE = [0.22, 1, 0.36, 1] as const

const VALUE_PILLS = LANDING.hero.proof

export default function HeroSection() {
  return (
    <section className="landing-hero relative overflow-x-clip">
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 lg:pt-20 pb-8 sm:pb-10 lg:pb-12">
        <div className="landing-hero__layout">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: EASE }}
            className="landing-hero__content"
          >
            <p className="landing-hero__eyebrow text-[11px] sm:text-xs font-semibold text-violet-600 uppercase tracking-widest mb-4 sm:mb-5">
              {LANDING.hero.eyebrow}
            </p>

            <h1 className="landing-hero__headline text-[1.85rem] sm:text-[2.75rem] lg:text-[3.25rem] xl:text-[3.5rem] text-zinc-950 mb-5 sm:mb-6">
              {LANDING.hero.headline}
              <br />
              <span className="text-violet-600">{LANDING.hero.headlineAccent}</span>
            </h1>

            <p className="landing-hero__subtext text-[15px] sm:text-lg text-zinc-500 leading-relaxed mb-6 sm:mb-7 max-w-lg">
              {LANDING.hero.subtext}
            </p>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-7 sm:mb-8">
              {VALUE_PILLS.map((pill) => (
                <div key={pill.label} className="flex items-baseline gap-1.5">
                  <span className="text-sm sm:text-base font-bold text-zinc-900 tabular-nums">{pill.value}</span>
                  <span className="text-xs sm:text-sm text-zinc-400 font-medium">{pill.label}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6 sm:mb-7">
              <CtaLink>
                <span className="landing-hero__cta-primary inline-flex w-full sm:w-auto items-center justify-center gap-2 text-white text-sm sm:text-[15px] font-semibold px-6 sm:px-7 py-3 sm:py-3.5 rounded-full cursor-pointer">
                  Inizia gratis — nessuna carta richiesta
                  <ArrowRight size={17} strokeWidth={2.25} />
                </span>
              </CtaLink>
              <a
                href="#platform"
                className="landing-hero__cta-secondary inline-flex w-full sm:w-auto items-center justify-center text-sm sm:text-[15px] font-semibold px-6 sm:px-7 py-3 sm:py-3.5 rounded-full transition-colors"
              >
                Vedi la piattaforma
              </a>
            </div>

            <p className="text-xs sm:text-sm text-zinc-500 mb-8 sm:mb-10 leading-relaxed max-w-lg">
              {LANDING.creditRule} · {LANDING.freeCreditsLabel} alla registrazione
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.75, ease: EASE }}
            className="landing-hero__visual-wrap"
          >
            <HeroLushaVisual />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.65, ease: EASE }}
          className="landing-hero__trust mt-12 sm:mt-16 lg:mt-20 pt-8 sm:pt-10 border-t border-zinc-100"
        >
          <p className="text-center text-xs sm:text-sm font-medium text-zinc-400 mb-5 sm:mb-6">
            {LANDING.hero.trustLine}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 px-2 mb-6 sm:mb-8">
            {['Ricerca AI', 'Audit tecnico', 'Lead Hotlist', 'Pitch AI', 'Centro Outreach', 'Pipeline'].map((label) => (
              <span key={label} className="landing-hero__trust-pill text-xs sm:text-sm font-medium">
                {label}
              </span>
            ))}
          </div>
          <p className="text-center text-sm sm:text-[15px] text-violet-700 font-medium max-w-2xl mx-auto leading-relaxed px-2">
            {LANDING.hero.coachLine}
          </p>
        </motion.div>
      </div>
    </section>
  )
}
