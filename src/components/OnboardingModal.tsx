'use client'

import { useState, useEffect } from 'react'
import { Search, Zap, Target, ArrowRight, X } from 'lucide-react'

const steps = [
  {
    icon: Search,
    iconBg: 'bg-violet-100 border-violet-200',
    iconColor: 'text-violet-600',
    title: 'Cerca il tuo mercato',
    description: 'Scrivi una categoria + città nella barra di ricerca. Ad esempio: "ristoranti a Milano senza Google Ads". Il nostro AI capirà esattamente cosa cerchi.',
    tip: '💡 Puoi filtrare per problemi specifici: "senza Instagram", "senza pixel", "senza SSL"',
  },
  {
    icon: Target,
    iconBg: 'bg-blue-100 border-blue-200',
    iconColor: 'text-blue-600',
    title: 'Analizza i lead',
    description: 'Ogni lead viene analizzato in tempo reale: audit tecnico, social, ads, recensioni. Lo score AI ti dice subito chi ha più bisogno di te.',
    tip: '💡 Clicca su "Dettaglio Lead" per vedere l\'analisi completa con competitor e trend',
  },
  {
    icon: Zap,
    iconBg: 'bg-amber-100 border-amber-200',
    iconColor: 'text-amber-600',
    title: 'Chiudi il cliente',
    description: 'Genera un pitch AI personalizzato basato sui problemi reali del lead. Copia, incolla, invia. Dal target al contatto qualificato in 2 minuti.',
    tip: '💡 Salva i lead migliori negli Ambienti per organizzare il tuo pipeline',
  },
]

export default function OnboardingModal() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const seen = localStorage.getItem('ckb_onboarding_done')
    if (!seen) {
      const timer = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  const close = () => {
    localStorage.setItem('ckb_onboarding_done', '1')
    setVisible(false)
  }

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      close()
    }
  }

  if (!visible) return null

  const current = steps[step]
  const Icon = current.icon

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Progress bar */}
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-500"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Close */}
        <button
          onClick={close}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors z-10"
        >
          <X className="w-4 h-4 text-slate-500" />
        </button>

        {/* Content */}
        <div className="p-8 pt-10">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === step ? 'w-8 bg-violet-500' : i < step ? 'w-2 bg-violet-300' : 'w-2 bg-slate-200'
                }`}
              />
            ))}
            <span className="ml-auto text-xs text-slate-400 font-medium">
              {step + 1} di {steps.length}
            </span>
          </div>

          {/* Icon */}
          <div className={`w-14 h-14 rounded-2xl ${current.iconBg} border flex items-center justify-center mb-5`}>
            <Icon className={`w-7 h-7 ${current.iconColor}`} />
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-slate-900 mb-3" style={{ fontFamily: 'Syne, sans-serif' }}>
            {current.title}
          </h2>

          {/* Description */}
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            {current.description}
          </p>

          {/* Tip */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 mb-8">
            <p className="text-xs text-slate-500 leading-relaxed">
              {current.tip}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={close}
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              Salta tutorial
            </button>
            <button
              onClick={next}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
            >
              {step < steps.length - 1 ? 'Avanti' : 'Inizia!'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
