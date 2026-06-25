'use client'

import {
  MapPinned,
  Smartphone,
  Mail,
  FileSpreadsheet,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { motion } from 'framer-motion'

// ─── Mini mockups — tutti con .mockup-ui per font Inter coerente ────

function MockupMap() {
  return (
    <div className="mockup-ui mt-5 rounded-xl border border-zinc-700/50 bg-zinc-900 p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-300">
          Centri Sportivi • Milano
        </div>
        <div className="rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-semibold text-white">
          Cerca
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-500">Raggio</span>
        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300 font-medium">5 km</span>
      </div>
    </div>
  )
}

function MockupPhone() {
  return (
    <div className="mockup-ui mt-5 rounded-xl border border-zinc-700/50 bg-zinc-900 p-3 space-y-2">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-400 font-medium">Tipo numero</span>
        <span className="text-zinc-500">Verificato</span>
      </div>
      {[
        { label: 'Fisso', active: false },
        { label: 'Mobile', active: true },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2">
          <span className={`text-[11px] font-medium ${item.active ? 'text-emerald-400' : 'text-zinc-500'}`}>{item.label}</span>
          <div className={`h-4 w-7 rounded-full p-0.5 transition-colors ${item.active ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
            <div className={`h-3 w-3 rounded-full bg-white transition-transform ${item.active ? 'translate-x-3' : ''}`} />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-500">Confidence</span>
        <span className="font-bold text-emerald-400">98%</span>
      </div>
    </div>
  )
}

function MockupEmail() {
  return (
    <div className="mockup-ui mt-5 space-y-2">
      {[
        { n: 'Marco B.', r: 'Founder', s: 'verified' },
        { n: 'Giulia R.', r: 'CEO', s: 'verified' },
        { n: 'Paolo C.', r: 'Head of Sales', s: 'found' },
      ].map(row => (
        <div key={row.n} className="flex items-center justify-between rounded-xl border border-zinc-700/50 bg-zinc-900 px-3 py-2">
          <div>
            <div className="text-[11px] font-semibold text-zinc-200">{row.n}</div>
            <div className="text-[10px] text-zinc-500">{row.r}</div>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
            row.s === 'verified'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-violet-500/30 bg-violet-500/10 text-violet-400'
          }`}>
            {row.s === 'verified' ? 'Verified' : 'Found'}
          </span>
        </div>
      ))}
    </div>
  )
}

function MockupExport() {
  return (
    <div className="mockup-ui mt-5 rounded-xl border border-zinc-700/50 bg-zinc-900 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-zinc-300">Export</span>
        <span className="text-[10px] text-zinc-500">CSV</span>
      </div>
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-zinc-400">data_export_oggi.csv</span>
          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
            Download
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-700">
          <div className="h-full w-4/5 rounded-full bg-violet-500" />
        </div>
      </div>
    </div>
  )
}

function MockupCompliance() {
  return (
    <div className="mockup-ui mt-5 space-y-2">
      {[
        { label: 'Deduplication', on: true },
        { label: 'Email validation', on: true },
        { label: 'Opt-out rules', on: true },
      ].map(i => (
        <div key={i.label} className="flex items-center justify-between rounded-xl border border-zinc-700/50 bg-zinc-900 px-3 py-2.5">
          <span className="text-[11px] font-medium text-zinc-300">{i.label}</span>
          <div className="h-2 w-2 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px rgba(52,211,153,0.6)' }} />
        </div>
      ))}
    </div>
  )
}

function MockupPitch() {
  return (
    <div className="mockup-ui mt-5 rounded-xl border border-zinc-700/50 bg-zinc-900 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={10} className="text-violet-400" />
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Pitch AI generato</span>
      </div>
      <div className="text-[11px] text-zinc-400 leading-relaxed italic mb-3">
        "Buongiorno Marco, ho analizzato il sito di Studio Rossi e ho notato che manca il Meta Pixel. State perdendo dati preziosi..."
      </div>
      <div className="flex gap-2">
        <span className="text-[10px] font-semibold text-white bg-violet-600 px-2.5 py-1 rounded-lg cursor-pointer">Copia</span>
        <span className="text-[10px] font-semibold text-violet-400 border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 rounded-lg cursor-pointer">Modifica</span>
      </div>
    </div>
  )
}

// ─── Features data ───────────────────────────────────────────────────
const features = [
  {
    icon: MapPinned,
    title: 'Ricerca Iper-Localizzata',
    description: 'Città, categoria e raggio km per colpire il mercato giusto con precisione chirurgica.',
    span: 'lg:col-span-2',
    mockup: MockupMap,
  },
  {
    icon: Smartphone,
    title: 'Cellulari Verificati',
    description: 'Algoritmo proprietario che separa mobile da fisso. Zero sprechi su centralini.',
    span: 'lg:col-span-1',
    mockup: MockupPhone,
  },
  {
    icon: Mail,
    title: 'Email dei Decision Maker',
    description: 'Contatti diretti del CEO, Founder, Owner, Head of Sales — non l\'info@ generico.',
    span: 'lg:col-span-1',
    mockup: MockupEmail,
  },
  {
    icon: FileSpreadsheet,
    title: 'Export CSV/Excel Immediato',
    description: 'Esporta tutti i lead con un click. Compatibile con HubSpot, Pipedrive, Notion.',
    span: 'lg:col-span-1',
    mockup: MockupExport,
  },
  {
    icon: ShieldCheck,
    title: 'Qualità & Compliance GDPR',
    description: 'Deduplication, email validation e opt-out rules integrate. Database sempre pulito.',
    span: 'lg:col-span-1',
    mockup: MockupCompliance,
  },
  {
    icon: Sparkles,
    title: 'Pitch AI Personalizzato',
    description: 'L\'AI scrive l\'email per te usando i problemi reali dell\'azienda come leva. Copi, invii, chiudi.',
    span: 'lg:col-span-2',
    mockup: MockupPitch,
  },
]

export default function FeaturesSection() {
  return (
    <section
      id="features"
      style={{ background: '#09090b' }}
      className="py-20 sm:py-28 lg:py-32 relative overflow-hidden"
    >
      {/* Subtle radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-[100px] pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)' }} />

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-[11px] font-semibold text-violet-400 uppercase tracking-widest mb-4">
            Funzionalità
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight mb-4">
            Tutto quello che serve per chiudere clienti.
          </h2>
          <p className="text-base text-zinc-400 max-w-lg mx-auto">
            Progettate per conversione, velocità e qualità dei dati. Strumenti che generano fatturato.
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {features.map((f, idx) => {
            const MockupCmp = f.mockup
            return (
              <motion.div
                key={f.title}
                className={f.span}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.06 }}
              >
                <div className="group h-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 hover:border-zinc-700 hover:bg-zinc-900 transition-all duration-300 relative overflow-hidden">
                  {/* Hover glow */}
                  <div className="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-violet-600/5 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                      <f.icon className="h-4 w-4 text-zinc-300" />
                    </div>
                  </div>
                  <div className="mt-4 text-[15px] font-semibold text-zinc-100 leading-snug">{f.title}</div>
                  <div className="mt-2 text-sm text-zinc-400 leading-relaxed">{f.description}</div>
                  <MockupCmp />
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
