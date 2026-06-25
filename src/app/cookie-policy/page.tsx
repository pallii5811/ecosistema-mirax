import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Cookie Policy | MIRAX',
  description: 'Informativa sull\'uso dei cookie su MIRAX.',
}

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-slate-900" style={{ fontFamily: 'Syne, sans-serif' }}>
            MIRAX
          </Link>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Torna alla home
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
          Cookie Policy
        </h1>
        <p className="text-sm text-slate-500 mb-10">Ultimo aggiornamento: {new Date().toLocaleDateString('it-IT')}</p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Cosa sono i Cookie</h2>
            <p>
              I cookie sono piccoli file di testo che vengono memorizzati sul tuo dispositivo quando visiti un sito web.
              Servono a ricordare le tue preferenze, migliorare la tua esperienza di navigazione e
              fornirci informazioni aggregate sull&apos;utilizzo del sito.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Cookie utilizzati</h2>

            <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">Cookie tecnici (necessari)</h3>
            <p>Essenziali per il funzionamento del sito. Non richiedono consenso.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm border border-slate-200 rounded-lg">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-slate-700">Cookie</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-700">Scopo</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-700">Durata</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-200">
                    <td className="px-4 py-2 font-mono text-xs">sb-*-auth-token</td>
                    <td className="px-4 py-2">Autenticazione utente (Supabase)</td>
                    <td className="px-4 py-2">Sessione</td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="px-4 py-2 font-mono text-xs">ckb_cookie_consent</td>
                    <td className="px-4 py-2">Memorizza la scelta cookie dell&apos;utente</td>
                    <td className="px-4 py-2">12 mesi</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Cookie analitici (previo consenso)</h3>
            <p>Utilizzati per raccogliere informazioni aggregate sull&apos;utilizzo del sito.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm border border-slate-200 rounded-lg">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-slate-700">Cookie</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-700">Scopo</th>
                    <th className="text-left px-4 py-2 font-semibold text-slate-700">Durata</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-200">
                    <td className="px-4 py-2 font-mono text-xs">_va</td>
                    <td className="px-4 py-2">Vercel Analytics — metriche di performance</td>
                    <td className="px-4 py-2">Sessione</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. Gestione dei Cookie</h2>
            <p>
              Al primo accesso al sito, ti viene mostrato un banner per scegliere quali cookie accettare.
              Puoi modificare le tue preferenze in qualsiasi momento:
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Cliccando sul link &quot;Gestisci cookie&quot; nel footer del sito</li>
              <li>Modificando le impostazioni del tuo browser</li>
              <li>Cancellando i cookie dal tuo dispositivo</li>
            </ul>
            <p className="mt-2">
              La disattivazione dei cookie tecnici potrebbe impedire il corretto funzionamento del sito.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Cookie di terze parti</h2>
            <p>
              Il nostro sito potrebbe contenere cookie di terze parti per le seguenti finalità:
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Stripe:</strong> elaborazione sicura dei pagamenti</li>
              <li><strong>Supabase:</strong> gestione sessione di autenticazione</li>
              <li><strong>Vercel:</strong> analytics e performance monitoring</li>
            </ul>
            <p className="mt-2">
              Per le rispettive privacy policy, consulta i siti dei fornitori.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Riferimenti normativi</h2>
            <p>
              La presente Cookie Policy è redatta ai sensi del Regolamento UE 2016/679 (GDPR),
              del D.Lgs. 196/2003 (Codice Privacy) e delle Linee Guida del Garante Privacy
              sui cookie e altri strumenti di tracciamento del 10 giugno 2021.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Contatti</h2>
            <p>
              Per domande sulla nostra Cookie Policy, contattaci a{' '}
              <a href="mailto:privacy@miraxgroup.it" className="text-violet-600 hover:underline">privacy@miraxgroup.it</a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
