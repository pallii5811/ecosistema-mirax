'use client'

import { motion } from 'framer-motion'
import { Database, Timer, Star } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import '@/styles/landing-stats-bar.css'

const STATS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: '4M+', label: 'Aziende nel database', icon: Database },
  { value: '< 2 min', label: 'Dal click al lead', icon: Timer },
  { value: '4.9/5', label: 'Da 200+ agenzie', icon: Star },
]

const EASE = [0.22, 1, 0.36, 1] as const

export default function SocialProofBar() {
  return (
    <section className="landing-stats border-t border-zinc-100/90 pb-14 sm:pb-20 lg:pb-24" aria-label="Metriche Mirax">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-30px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="landing-stats__panel rounded-2xl sm:rounded-3xl overflow-hidden"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3">
            {STATS.map((stat, i) => {
              const Icon = stat.icon
              return (
                <div key={stat.label} className="relative flex sm:block">
                  {i > 0 && (
                    <div
                      className="landing-stats__divider absolute top-0 left-4 right-4 h-px sm:left-0 sm:right-auto sm:top-4 sm:bottom-4 sm:w-px sm:h-auto"
                      aria-hidden="true"
                    />
                  )}

                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
                    className="flex sm:flex-col items-center sm:items-center gap-3 sm:gap-2 px-5 py-4 sm:py-6 sm:text-center w-full"
                  >
                    <span className="landing-stats__icon w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon size={15} strokeWidth={2} />
                    </span>

                    <div className="min-w-0 flex-1 sm:flex-none text-left sm:text-center">
                      <div className="landing-stats__value text-xl sm:text-2xl font-bold text-zinc-900 leading-none">
                        {stat.value}
                      </div>
                      <div className="text-[11px] sm:text-xs text-zinc-500 mt-1 leading-snug">
                        {stat.label}
                      </div>
                    </div>
                  </motion.div>
                </div>
              )
            })}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
