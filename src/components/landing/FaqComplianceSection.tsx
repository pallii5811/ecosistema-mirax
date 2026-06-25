'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { LANDING } from '@/lib/landing-copy'

const faqs = [
  {
    q: 'Da dove provengono i dati?',
    a: `${LANDING.dataSource} Ogni ricerca avvia una scansione on-demand e un audit tecnico del sito.`,
  },
  {
    q: 'I numeri di telefono sono reali?',
    a: 'MIRAX filtra i lead senza telefono o email, scarta numeri non validi e separa i centralini dai cellulari dove possibile. Ogni lead consuma un credito solo se ha almeno un contatto utilizzabile.',
  },
  {
    q: 'Come funzionano i crediti?',
    a: 'Un credito = un lead estratto con telefono o email. Le ricerche a vuoto non consumano crediti. Alla registrazione ricevi 10 crediti gratuiti. I piani a pagamento rinnovano i crediti ogni mese.',
  },
  {
    q: "Posso cancellare l'abbonamento?",
    a: 'Sì, in un click dalla dashboard. Nessun vincolo contrattuale. Garanzia 14 giorni soddisfatti o rimborsati sui piani a pagamento.',
  },
  {
    q: 'Cos\'è il Centro Outreach?',
    a: 'È la console per contattare i lead dalla lista: pitch AI con motivazione, apertura su WhatsApp, email o LinkedIn, log di ogni invio e protezione anti-duplicato su 7 giorni. Include anche il Campaign Agent per prioritizzare la coda.',
  },
  {
    q: 'Come funziona il Pitch AI?',
    a: "L'AI legge i problemi reali del sito — Pixel assente, GTM mancante, errori SEO — e genera un messaggio con oggetto, corpo e CTA specifici per quell'azienda. Non è un template generico.",
  },
  {
    q: 'Funziona per qualsiasi settore?',
    a: 'Sì, per qualsiasi attività commerciale italiana nel territorio: ristoranti, studi professionali, negozi, artigiani, palestre, imprese edili. Scrivi in italiano cosa cerchi e il motore interpreta categoria, città e filtri.',
  },
  {
    q: 'Posso integrare i dati nel mio CRM?',
    a: `${LANDING.integrations} Sync bulk verso HubSpot dalle liste. Le sequenze email automatiche sono disponibili con Resend dalla dashboard.`,
  },
] as const

export default function FaqComplianceSection() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section className="bg-white py-20 sm:py-28 lg:py-32">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <div className="mb-14">
          <p className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest mb-4">FAQ</p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight leading-tight">
              Domande frequenti.
            </h2>
            <div className="sm:ml-auto flex-shrink-0">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Server in UE · Privacy policy
              </span>
            </div>
          </div>
        </div>

        <div className="divide-y divide-zinc-100">
          {faqs.map((item, i) => (
            <motion.div
              key={item.q}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.03 }}
            >
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-6 py-5 text-left cursor-pointer bg-transparent border-none"
              >
                <span className="text-[15px] font-medium text-zinc-800 leading-snug">
                  {item.q}
                </span>
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                  open === i
                    ? 'border-violet-200 bg-violet-50 rotate-45'
                    : 'border-zinc-200 bg-white'
                }`}>
                  <Plus size={13} className={open === i ? 'text-violet-600' : 'text-zinc-400'} />
                </div>
              </button>

              <AnimatePresence>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    <p className="pb-5 text-sm text-zinc-500 leading-relaxed max-w-lg">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
