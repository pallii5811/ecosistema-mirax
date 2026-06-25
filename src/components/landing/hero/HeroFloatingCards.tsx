'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Phone, AlertTriangle } from 'lucide-react'

type Props = { phase: number }

const CARDS = [
  {
    side: 'right' as const,
    top: '12%',
    key: 'score',
    label: 'Score opportunità',
    value: '88',
    suffix: '/100',
    accent: 'text-violet-600',
    icon: Sparkles,
    showOn: 0,
  },
  {
    side: 'right' as const,
    top: '58%',
    key: 'contacts',
    label: 'Contatti verificati',
    value: '5',
    suffix: ' diretti',
    accent: 'text-emerald-600',
    icon: Phone,
    showOn: 1,
  },
  {
    side: 'left' as const,
    top: '68%',
    key: 'signals',
    label: 'Segnali critici',
    value: '6',
    suffix: ' vendibili',
    accent: 'text-amber-600',
    icon: AlertTriangle,
    showOn: 2,
  },
]

export default function HeroFloatingCards({ phase }: Props) {
  const visible = CARDS.filter((c) => c.showOn === phase)

  return (
    <div className="absolute inset-0 pointer-events-none hidden lg:block">
      <AnimatePresence mode="wait">
        {visible.map((card) => {
          const Icon = card.icon
          return (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, x: card.side === 'right' ? 16 : -16, y: 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: card.side === 'right' ? 12 : -12 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className={`absolute landing-hero__float-card rounded-xl px-3.5 py-3 min-w-[148px] ${
                card.side === 'right' ? '-right-6' : '-left-6'
              }`}
              style={{ top: card.top }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={12} className={card.accent} />
                <span className="text-[10px] font-medium text-zinc-500">{card.label}</span>
              </div>
              <div className={`text-xl font-bold tabular-nums tracking-tight ${card.accent}`}>
                {card.value}
                <span className="text-xs font-medium text-zinc-400">{card.suffix}</span>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
