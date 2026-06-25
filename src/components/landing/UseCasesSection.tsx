'use client'

import { ArrowRight, Crosshair, Users, Search, MailWarning, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import CtaLink from '@/components/CtaLink'

export default function UseCasesSection() {
  return (
    <section id="intelligence" className="w-full bg-white py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex items-center justify-between gap-6 flex-col md:flex-row">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm">
              <Sparkles className="h-4 w-4 text-violet-600" />
              Intelligence & Segnali d'Acquisto
            </div>
            <h2 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              Non Ti Diamo un Contatto. Ti Diamo il Momento Giusto.
            </h2>
            <p className="mt-4 text-lg text-slate-700">
              Mirax analizza l'infrastruttura digitale dei tuoi
              prospect in tempo reale. Trovi i punti deboli prima ancora
              di presentarti.
            </p>
          </div>

          <Button
            asChild
            className="h-12 px-7 text-base bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 shadow-lg transition-all cta-glow-hover"
          >
            <CtaLink>
              Provalo Gratis
              <ArrowRight className="ml-2 h-5 w-5" />
            </CtaLink>
          </Button>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-7 rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur p-8 shadow-xl shadow-violet-500/10 hover:shadow-indigo-500/20 transition-shadow">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                <Crosshair className="h-6 w-6 text-violet-200" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">Radar X Tecnologico</div>
                <div className="text-sm text-slate-300">Segnali d'acquisto in tempo reale</div>
              </div>
            </div>
            <p className="mt-5 text-slate-200 leading-relaxed">
              Mirax analizza SEO, Pixel, SSL, DMARC, velocità e social.
              Sai cosa dire e perché stanno perdendo soldi, prima ancora della chiamata.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {['MISSING FB PIXEL', 'SITO LENTO', 'NO DMARC', 'SCHEDA NON RIVENDICATA'].map((t) => (
                <div key={t} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-mono text-slate-200">
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div className="md:col-span-5 rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur p-8 shadow-xl shadow-violet-500/10 hover:shadow-indigo-500/20 transition-shadow">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-emerald-200" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">Cacciatore di Decision Maker</div>
                <div className="text-sm text-slate-300">Bypass i centralini</div>
              </div>
            </div>
            <p className="mt-5 text-slate-200 leading-relaxed">
              Identifichiamo titolari e contatti diretti nelle pagine
              “Chi Siamo”. Parli con chi firma.
            </p>
          </div>

          <div className="md:col-span-6 rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur p-8 shadow-xl shadow-violet-500/10 hover:shadow-indigo-500/20 transition-shadow">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                <Search className="h-6 w-6 text-amber-200" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">Analisi Reputazione</div>
                <div className="text-sm text-slate-300">Friczione bassa, chiusura veloce</div>
              </div>
            </div>
            <p className="mt-5 text-slate-200 leading-relaxed">
              Trova aziende con rating in calo, poche recensioni o risposte aggressive.
              Sono le più facili da chiudere: sanno di avere un problema.
            </p>
          </div>

          <div className="md:col-span-6 rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur p-8 shadow-xl shadow-violet-500/10 hover:shadow-indigo-500/20 transition-shadow">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                <MailWarning className="h-6 w-6 text-fuchsia-200" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">Pitch AI Personalizzato</div>
                <div className="text-sm text-slate-300">Copia. Incolla. Chiudi.</div>
              </div>
            </div>
            <p className="mt-5 text-slate-200 leading-relaxed">
              Un messaggio scritto su misura per ogni lead, basato sui suoi problemi.
              Oggetto, corpo, CTA. Sei pronto prima ancora di alzare il telefono.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
