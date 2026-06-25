'use client'

import { ArrowRight, Zap } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

export function ROICalculator() {
  return (
    <section className="py-20 sm:py-28 lg:py-32 bg-zinc-50">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        {/* Header */}
        <div className="mb-14">
          <p className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest mb-4">
            Il tuo ROI
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight leading-tight max-w-2xl">
            Quanto ti costa non usare MIRAX?
          </h2>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {/* Revenue — accented */}
          <motion.div
            className="rounded-2xl border border-violet-200 bg-violet-600 p-8 relative overflow-hidden"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full border border-white/10 pointer-events-none" />
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-5">
              Revenue aggiuntiva
            </p>
            <div className="text-5xl font-bold text-white tracking-tight leading-none mb-2">
              +€4.800
            </div>
            <div className="text-sm text-white/50">al mese per agency</div>
          </motion.div>

          {/* Tempo */}
          <motion.div
            className="rounded-2xl border border-zinc-200 bg-white p-8"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
          >
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-5">
              Tempo risparmiato
            </p>
            <div className="text-4xl font-bold text-zinc-900 tracking-tight mb-2">-15h</div>
            <div className="text-sm text-zinc-500 mb-5">Ore risparmiate a settimana</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 line-through">3-4h per 10 lead</span>
              <ArrowRight size={11} className="text-zinc-300" />
              <span className="text-xs font-bold text-emerald-600">2 min</span>
            </div>
          </motion.div>

          {/* Tasso risposta */}
          <motion.div
            className="rounded-2xl border border-zinc-200 bg-white p-8"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.14 }}
          >
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-5">
              Tasso di risposta
            </p>
            <div className="text-4xl font-bold text-zinc-900 tracking-tight mb-2">10-20%</div>
            <div className="text-sm text-zinc-500 mb-5">vs 1-3% con lista fredda</div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-400 w-16">Lista fredda</span>
                <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-zinc-300 rounded-full" style={{ width: '10%' }} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-violet-600 w-16">MIRAX</span>
                <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full" style={{ width: '65%' }} />
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom callout */}
        <motion.div
          className="rounded-2xl border border-zinc-200 bg-white px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-6"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Zap size={18} className="text-violet-600" />
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-900">Il calcolo è semplice</div>
              <div className="text-sm text-zinc-400">
                €49/mese → chiudi <strong className="text-zinc-700">1 solo cliente</strong> → ROI del{' '}
                <strong className="text-emerald-600">+9.700%</strong>
              </div>
            </div>
          </div>
          <CtaLink>
            <span className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-6 py-3 rounded-xl cursor-pointer transition-all flex-shrink-0">
              Inizia Gratis
              <ArrowRight size={14} />
            </span>
          </CtaLink>
        </motion.div>
      </div>
    </section>
  )
}
