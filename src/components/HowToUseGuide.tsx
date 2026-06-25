'use client'

import { useState, useEffect } from 'react'
import { X, Search, Sparkles, ChevronRight, ChevronLeft, MapPin, Zap, Filter, MousePointerClick, Download, Target, Globe } from 'lucide-react'

type GuideMode = 'maps' | 'ambiente'

interface HowToUseGuideProps {
  open: boolean
  onClose: () => void
  mode: GuideMode
}

const mapsSteps = [
  {
    icon: Search,
    title: 'Scrivi la tua ricerca',
    description: 'Digita nella barra: categoria + città. Esempio:',
    examples: ['Ristoranti a Milano', 'Dentisti Roma', 'Hotel Firenze'],
    tip: 'Puoi scrivere in modo naturale, l\'AI capisce la tua richiesta.',
  },
  {
    icon: Filter,
    title: 'Aggiungi filtri (opzionale)',
    description: 'Aggiungi un filtro per trovare aziende con problemi specifici che puoi risolvere:',
    examples: [
      'Ristoranti a Milano senza sito',
      'Palestre Napoli senza Instagram',
      'Dentisti Roma senza Google Ads',
      'Hotel Firenze senza Pixel',
    ],
    tip: 'Puoi anche cliccare sui filtri rapidi sotto la barra di ricerca.',
  },
  {
    icon: Zap,
    title: 'Risultati istantanei',
    description: 'Il sistema trova le aziende nel database e ti mostra:',
    examples: [
      'Telefono e cellulare verificati',
      'Email, PEC e contatti decision maker',
      'Analisi tecnica completa del sito',
      'Tutti i problemi e le opportunità',
      'Score AI di vendibilità',
    ],
    tip: 'Ogni lead costa 1 credito. Puoi esportare in CSV.',
  },
  {
    icon: MousePointerClick,
    title: 'Entra nel dettaglio',
    description: 'Clicca su un lead per vedere tutto:',
    examples: [
      'Profilo aziendale completo (P.IVA, sede, dipendenti)',
      'Referente con nome, ruolo e LinkedIn',
      'Tutti i problemi tecnici del sito',
      'Pitch AI personalizzato pronto da inviare',
    ],
    tip: 'Usa il pitch AI per contattare il lead con una proposta mirata.',
  },
  {
    icon: Download,
    title: 'Salva e organizza',
    description: 'Non perdere i tuoi lead:',
    examples: [
      'Salva in un Ambiente per organizzarli',
      'Esporta in CSV/Excel',
      'Aggiungi alla Pipeline commerciale',
      'Invia sequenze email automatiche',
    ],
    tip: 'Gli Ambienti ti permettono di organizzare i lead per progetto o cliente.',
  },
]

const ambienteSteps = [
  {
    icon: Globe,
    title: 'Cos\'è la Ricerca Ambiente',
    description: 'Una ricerca AI avanzata che analizza tutto il web in tempo reale per trovare aziende correlate a un topic specifico.',
    examples: [
      'Trova aziende non presenti nel database standard',
      'L\'AI analizza centinaia di fonti web automaticamente',
      'Risultati più ampi e diversificati rispetto alla ricerca standard',
    ],
    tip: 'Ideale quando vuoi esplorare nicchie specifiche o trovare aziende nuove.',
  },
  {
    icon: Search,
    title: 'Scrivi il topic',
    description: 'Inserisci un argomento o settore + città nella barra di ricerca. Esempio:',
    examples: [
      'comunicazione milano',
      'software house roma',
      'e-commerce moda italia',
      'studi legali torino',
    ],
    tip: 'Più specifico sei, migliori saranno i risultati.',
  },
  {
    icon: Target,
    title: 'Scegli quanti lead vuoi trovare',
    description: 'Seleziona il numero di lead desiderati dal selettore accanto alla barra:',
    examples: ['10 lead — ricerca rapida (~1 min)', '25 lead — bilanciato (~2 min)', '50 lead — approfondito (~3 min)', '100 lead — massimo (~5 min)'],
    tip: 'Più lead richiedi, più tempo ci vorrà per l\'analisi.',
  },
  {
    icon: Zap,
    title: 'Avvia e attendi i risultati',
    description: 'Clicca "Avvia Ricerca AI" e attendi che l\'analisi termini:',
    examples: [
      'L\'AI analizza il web in tempo reale per il tuo topic',
      'I risultati appariranno automaticamente nella pagina',
      'Ogni lead include contatti, sito e analisi tecnica',
      'Non chiudere la pagina durante l\'analisi',
    ],
    tip: 'Tempo medio: 2-3 minuti. I lead appariranno man mano che vengono trovati.',
  },
]

export default function HowToUseGuide({ open, onClose, mode }: HowToUseGuideProps) {
  const [step, setStep] = useState(0)
  const steps = mode === 'maps' ? mapsSteps : ambienteSteps

  useEffect(() => {
    setStep(0)
  }, [mode, open])

  if (!open) return null

  const current = steps[step]
  const Icon = current.icon
  const isLast = step === steps.length - 1
  const isFirst = step === 0

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-indigo-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            {mode === 'maps' ? <MapPin className="w-5 h-5 text-violet-600" /> : <Sparkles className="w-5 h-5 text-fuchsia-600" />}
            <h3 className="text-base font-bold text-slate-800">
              {mode === 'maps' ? 'Come usare la Ricerca' : 'Come usare la Ricerca Ambiente'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-4 sm:px-6 pt-3 sm:pt-4 flex-shrink-0">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full flex-1 transition-all duration-300 ${
                i <= step ? (mode === 'maps' ? 'bg-violet-500' : 'bg-fuchsia-500') : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              mode === 'maps'
                ? 'bg-gradient-to-br from-violet-500 to-indigo-600'
                : 'bg-gradient-to-br from-fuchsia-500 to-violet-600'
            }`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Step {step + 1} di {steps.length}</p>
              <h4 className="text-lg font-bold text-slate-800">{current.title}</h4>
            </div>
          </div>

          <p className="text-sm text-slate-600 mb-3 leading-relaxed">{current.description}</p>

          <div className="space-y-1.5 mb-4">
            {current.examples.map((ex, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <ChevronRight className="w-3.5 h-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-slate-700">{ex}</span>
              </div>
            ))}
          </div>

          {current.tip && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              mode === 'maps'
                ? 'bg-violet-50 border-violet-100 text-violet-700'
                : 'bg-fuchsia-50 border-fuchsia-100 text-fuchsia-700'
            }`}>
              💡 <strong>Tip:</strong> {current.tip}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={isFirst}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Indietro
          </button>

          {isLast ? (
            <button
              onClick={onClose}
              className={`px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-all hover:scale-105 ${
                mode === 'maps'
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 shadow-violet-500/25'
                  : 'bg-gradient-to-r from-fuchsia-600 to-violet-600 shadow-fuchsia-500/25'
              }`}
            >
              Ho capito, iniziamo!
            </button>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              className={`flex items-center gap-1 px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-all hover:scale-105 ${
                mode === 'maps'
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 shadow-violet-500/25'
                  : 'bg-gradient-to-r from-fuchsia-600 to-violet-600 shadow-fuchsia-500/25'
              }`}
            >
              Avanti
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
