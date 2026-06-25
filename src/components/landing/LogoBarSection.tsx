'use client'

import { motion } from 'framer-motion'
import '@/styles/landing-logo-bar.css'

const ROW_A = [
  'PixelUp Torino',
  'GrowthLab Napoli',
  'SEOFactory Bologna',
  'BuildWeb SRL',
  'AlphaAgency Milano',
  'Consulting Hub Torino',
  'Media Factory Firenze',
  'WebWave Roma',
  'Social Boost Milano',
  'LeadForge Padova',
]

const ROW_B = [
  'WebAgency Roma',
  'Studio SEO Milano',
  'Digital Boost',
  'Grow Media',
  'Agenzia Pixel',
  'NordEst Digital',
  'Sud Web Studio',
  'ScaleUp Agency',
  'Inbound Lab',
  'Revenue Partners',
]

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

function AgencyPill({ name }: { name: string }) {
  return (
    <div className="landing-logo-bar__pill flex items-center gap-2 sm:gap-2.5 px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-full flex-shrink-0">
      <span className="landing-logo-bar__monogram w-5 h-5 sm:w-6 sm:h-6 rounded-md flex items-center justify-center text-[8px] sm:text-[9px] font-bold tracking-tight">
        {initials(name)}
      </span>
      <span className="text-[11px] sm:text-[12px] font-medium text-zinc-500 whitespace-nowrap tracking-tight">
        {name}
      </span>
    </div>
  )
}

function MarqueeRow({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  const loop = [...items, ...items]

  return (
    <div className="landing-logo-bar__row relative overflow-hidden py-0.5 sm:py-1">
      <div className="absolute left-0 top-0 bottom-0 w-12 sm:w-28 z-10 landing-logo-bar__edge" />
      <div className="absolute right-0 top-0 bottom-0 w-12 sm:w-28 z-10 landing-logo-bar__edge landing-logo-bar__edge--right" />

      <div
        className={`landing-logo-bar__track ${reverse ? 'landing-logo-bar__track--reverse' : ''}`}
        aria-hidden="true"
      >
        {loop.map((name, i) => (
          <AgencyPill key={`${name}-${i}`} name={name} />
        ))}
      </div>
    </div>
  )
}

export function LogoBarSection() {
  return (
    <section className="landing-logo-bar relative overflow-hidden pt-12 sm:pt-16 pb-10 sm:pb-12" aria-label="Agenzie che usano Mirax">
      <div className="landing-logo-bar__fade-top mb-8 sm:mb-10" />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className="text-center px-4 sm:px-5 mb-8 sm:mb-10"
      >
        <div className="inline-flex items-center gap-2 sm:gap-2.5 mb-2 sm:mb-3">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-50 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
          </span>
          <p className="landing-logo-bar__label text-[9px] sm:text-[11px] font-semibold text-zinc-400 uppercase">
            Social proof
          </p>
        </div>

        <h2 className="text-base sm:text-xl font-semibold text-zinc-900 tracking-tight leading-snug">
          Già scelto da{' '}
          <span className="landing-logo-bar__count inline-flex items-center rounded-full px-2 sm:px-2.5 py-0.5 text-xs sm:text-sm font-bold tabular-nums">
            200+
          </span>{' '}
          agency italiane
        </h2>
        <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-zinc-500 max-w-md mx-auto leading-relaxed px-2">
          Team commerciali, web agency e consulenti che chiudono più deal con meno ore di ricerca manuale.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-20px' }}
        transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="space-y-2 sm:space-y-3"
      >
        <MarqueeRow items={ROW_A} />
        <MarqueeRow items={ROW_B} reverse />
      </motion.div>
    </section>
  )
}
