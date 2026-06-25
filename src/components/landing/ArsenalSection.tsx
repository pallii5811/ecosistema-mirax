'use client'

import {
  Radar,
  Users,
  Smartphone,
  Sparkles,
  Star,
  RefreshCcw,
  ArrowRight,
  Check,
  Phone,
  Mail,
  AlertTriangle,
} from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'

// ─── Mockup components ─────────────────────────────────────────────

function AuditMockup() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-1.5 px-5 py-3 border-b border-zinc-100 bg-zinc-50">
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="flex-1" />
        <span className="text-[9px] text-zinc-400 tracking-wider font-medium">MIRAX Audit</span>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Analisi Tecnica</div>
            <div className="text-sm font-bold text-zinc-900 mt-1 leading-snug">Techlane | Milano - Assistenza, Gestione e Consulenza Informatica per le Aziende</div>
          </div>
          <span className="w-6 h-6 rounded border border-zinc-200 text-zinc-400 flex items-center justify-center text-xs flex-shrink-0 ml-3">×</span>
        </div>
        <div className="space-y-4">
          <div>
            <div className="text-[10px] font-bold text-zinc-900 mb-2">Errori SEO</div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              <div className="text-[9px] text-amber-900 leading-relaxed">
                <span className="font-bold">• CRITICAL:</span> Security: Mixed Content. Risorsa caricata in HTTP su pagina HTTPS (link: http://gnupg.org/xfn/11).
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-zinc-900 mb-2">Mancanze e Problemi (Priorità)</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[8px] font-bold bg-red-500 text-white px-2.5 py-1 rounded">NO PIXEL</span>
              <span className="text-[8px] font-bold bg-red-500 text-white px-2.5 py-1 rounded">NO GOOGLE ADS</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-zinc-900 mb-2">Stack Tecnologico (Presente)</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[8px] font-bold bg-emerald-500 text-white px-2.5 py-1 rounded">SSL OK</span>
              <span className="text-[8px] font-bold bg-blue-500 text-white px-2.5 py-1 rounded">WORDPRESS</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ContactsMockup() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-1.5 px-5 py-3 border-b border-zinc-100 bg-zinc-50">
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="flex-1" />
        <span className="text-[9px] text-zinc-400 tracking-wider font-medium">Contatti Verificati</span>
      </div>
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3 p-3 rounded-xl border border-zinc-100 bg-zinc-50">
          <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-bold">IN</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-zinc-800">Impresa Edile New York</div>
            <div className="text-[10px] text-zinc-400">Titolare / Amministrazione</div>
          </div>
          <span className="ml-auto text-[9px] font-semibold text-sky-600 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full hidden sm:inline">LinkedIn ↗</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3 py-2 px-3 rounded-lg border border-emerald-100 bg-emerald-50">
            <Phone size={12} className="text-emerald-600 flex-shrink-0" />
            <div>
              <div className="text-[9px] text-emerald-600/70">Cellulare verificato</div>
              <div className="text-xs font-bold text-emerald-700">+39 320 011 4068</div>
            </div>
            <span className="ml-auto text-[9px] font-bold text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded-md">MOBILE ✓</span>
          </div>
          <div className="flex items-center gap-3 py-2 px-3 rounded-lg border border-violet-100 bg-violet-50">
            <Mail size={12} className="text-violet-600 flex-shrink-0" />
            <div>
              <div className="text-[9px] text-violet-600/70">Email diretta</div>
              <div className="text-xs font-bold text-violet-700">amm@studiolegale.it</div>
            </div>
            <span className="ml-auto text-[9px] font-bold text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded-md">✓</span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
          <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Origine dati</div>
          <div className="flex flex-wrap gap-1.5">
            {['Territorio', 'Sito ufficiale', 'Registro imprese', 'Social'].map(t => (
              <span key={t} className="text-[8px] font-bold bg-white text-zinc-500 border border-zinc-200 px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1 text-[10px] text-zinc-400">
          <Star size={10} className="text-amber-400 fill-amber-400" />
          <span className="font-medium text-zinc-700">4.2</span>
          <span>(18 rec.) · ↓ in calo</span>
          <span className="ml-auto text-[9px] bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-md font-medium hidden sm:inline">Facebook · Instagram</span>
        </div>
      </div>
    </div>
  )
}

function PitchMockup() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-1.5 px-5 py-3 border-b border-zinc-100 bg-zinc-50">
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
        <span className="flex-1" />
        <span className="text-[9px] text-zinc-400 tracking-wider font-medium">AI Pitch</span>
      </div>
      <div className="px-5 py-4 border-b border-zinc-100">
        <div className="text-base font-bold text-zinc-950">Pitch Commerciale</div>
        <div className="text-[10px] text-zinc-500 mt-1">Impresa Edile New York · Forlì · Imprese edili</div>
      </div>
      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-3 h-3 rounded-full border border-violet-500" />
            <span className="text-[10px] text-zinc-500">Sto scrivendo una mail personalizzata...</span>
          </div>
          <div className="rounded-lg bg-white border border-zinc-100 p-3 text-[10px] text-zinc-600 leading-relaxed">
            Buongiorno, ho analizzato il vostro sito e ho notato che non state tracciando le visite da Google Ads. Questo significa perdere dati preziosi sui clienti interessati ai vostri servizi edili.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 flex items-center gap-2">
            <Phone size={12} className="text-emerald-600" />
            <div>
              <div className="text-[8px] text-emerald-700/70">Cellulare verificato</div>
              <div className="text-xs font-bold text-emerald-700">320 011 4068</div>
            </div>
          </div>
          <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 flex items-center gap-2">
            <Mail size={12} className="text-violet-600" />
            <div>
              <div className="text-[8px] text-violet-700/70">Email diretta</div>
              <div className="text-xs font-bold text-violet-700">amm@studio...</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
          <span className="rounded-lg bg-zinc-950 text-white text-[9px] sm:text-[10px] font-bold px-3 sm:px-4 py-1.5 sm:py-2">Chiudi</span>
          <span className="rounded-lg bg-zinc-500 text-white text-[9px] sm:text-[10px] font-bold px-3 sm:px-4 py-1.5 sm:py-2">Copia testo</span>
          <span className="rounded-lg bg-blue-600 text-white text-[9px] sm:text-[10px] font-bold px-3 sm:px-4 py-1.5 sm:py-2">Apri nel client mail</span>
        </div>
      </div>
    </div>
  )
}

// ─── Features ─────────────────────────────────────────────────────

const features = [
  {
    tag: 'Audit Tecnico Automatico',
    title: 'Il "trigger" del tuo prossimo contratto.',
    body: 'Nessuno risponderà mai a "compra il mio servizio". Ma se scrivi "stai perdendo il 40% del traffico per questo errore sul sito", ti chiederanno loro una call. MIRAX trova questi appigli per te: Meta Pixel, GTM, SSL, DMARC, velocità — tutto in un click.',
    bullets: [
      'Audit completo in automatico su ogni azienda',
      'Problemi prioritizzati per impatto commerciale',
      'Score 0–100 per sapere chi chiamare prima',
    ],
    mockup: AuditMockup,
    reverse: false,
  },
  {
    tag: 'Bypassa i Centralini',
    title: 'Cellulare del titolare. Non il centralino.',
    body: 'I filtri aziendali distruggono le vendite. MIRAX scova il cellulare personale del CEO e i contatti diretti dei manager decisionali — non email info@ che nessuno legge. Profilo LinkedIn, recensioni Google, social media in un unico pannello.',
    bullets: [
      'Cellulare mobile separato dal fisso e verificato',
      'Email diretta del decision maker (CEO, Founder, Owner)',
      'Profilo social e recensioni Google in tempo reale',
    ],
    mockup: ContactsMockup,
    reverse: true,
  },
  {
    tag: 'AI Pitch Personalizzato',
    title: 'L\'email già scritta, pronta da inviare.',
    body: 'L\'AI analizza i problemi reali dell\'azienda e scrive un\'email commerciale su misura — non un template generico. Usa i problemi specifici trovati come leva psicologica. Tasso di risposta dal 2% al 18% in media.',
    bullets: [
      'Pitch scritto usando i problemi reali del sito',
      'Oggetto, corpo e CTA ottimizzati per il settore',
      'Export immediato in CSV/Excel per il tuo CRM',
    ],
    mockup: PitchMockup,
    reverse: false,
  },
]

export default function ArsenalSection() {
  return (
    <section id="arsenal" className="bg-white py-20 sm:py-28 lg:py-32">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <p className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest mb-4">
            Il toolkit completo
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight leading-tight mb-4">
            Tutto quello che serve per chiudere il prossimo contratto.
          </h2>
          <p className="text-base text-zinc-400 max-w-lg mx-auto">
            Dati completi su ogni azienda: contatti verificati, analisi tecnica, profilo aziendale e pitch AI personalizzato.
          </p>
        </div>

        {/* Feature blocks */}
        <div className="space-y-24 lg:space-y-32">
          {features.map((f, idx) => {
            const MockupCmp = f.mockup
            return (
              <motion.div
                key={f.tag}
                className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center ${f.reverse ? '' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5 }}
              >
                {/* Text */}
                <div className={f.reverse ? 'lg:order-2' : ''}>
                  <p className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest mb-3">
                    {f.tag}
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight leading-snug mb-4">
                    {f.title}
                  </h3>
                  <p className="text-base text-zinc-500 leading-relaxed mb-7">
                    {f.body}
                  </p>
                  <ul className="space-y-3 mb-8">
                    {f.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Check size={10} className="text-violet-600" strokeWidth={3} />
                        </div>
                        <span className="text-sm text-zinc-600 leading-relaxed">{b}</span>
                      </li>
                    ))}
                  </ul>
                  {idx === features.length - 1 && (
                    <CtaLink>
                      <span className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg cursor-pointer transition-all">
                        Prova Gratis
                        <ArrowRight size={14} />
                      </span>
                    </CtaLink>
                  )}
                </div>

                {/* Mockup */}
                <div className={f.reverse ? 'lg:order-1' : ''}>
                  <MockupCmp />
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Mini feature grid — 3 col extra features */}
        <div className="mt-24 pt-16 border-t border-zinc-100">
          <h3 className="text-xl font-bold text-zinc-900 mb-8 text-center">Ancora di più, incluso in ogni piano.</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                icon: Star,
                title: 'Intercetta Imprese in Crisi',
                desc: 'Filtra le aziende a cui crollano le recensioni Google. Sarà più facile che si affidino a te.',
              },
              {
                icon: RefreshCcw,
                title: 'Data Freshness Garantita',
                desc: 'Ogni lead re-auditato automaticamente ogni 30 giorni. Zero dati obsoleti.',
              },
              {
                icon: Radar,
                title: 'Score di Priorità',
                desc: 'Ogni lead riceve un punteggio 0–100 basato sui problemi trovati. Chiama i migliori prima.',
              },
            ].map(item => (
              <div key={item.title} className="flex items-start gap-4 p-5 rounded-2xl border border-zinc-100 bg-zinc-50">
                <div className="w-9 h-9 rounded-xl bg-white border border-zinc-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <item.icon size={16} className="text-zinc-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-800 mb-1">{item.title}</div>
                  <div className="text-xs text-zinc-500 leading-relaxed">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
