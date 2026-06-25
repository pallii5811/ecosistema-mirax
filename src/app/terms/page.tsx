import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Termini di Servizio | MIRAX',
  description: 'Termini e condizioni di utilizzo della piattaforma MIRAX.',
}

export default function TermsPage() {
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
          Termini di Servizio
        </h1>
        <p className="text-sm text-slate-500 mb-10">Ultimo aggiornamento: {new Date().toLocaleDateString('it-IT')}</p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Accettazione dei Termini</h2>
            <p>
              Accedendo e utilizzando la piattaforma MIRAX (&quot;Servizio&quot;), accetti di essere vincolato
              dai presenti Termini di Servizio. Se non accetti questi termini, non utilizzare il Servizio.
              L&apos;uso continuato della piattaforma dopo eventuali modifiche costituisce accettazione dei termini aggiornati.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Descrizione del Servizio</h2>
            <p>
              MIRAX è una piattaforma SaaS di lead generation B2B che consente agli utenti di:
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Ricercare aziende per categoria e localizzazione geografica</li>
              <li>Ottenere audit tecnici automatizzati dei siti web (SEO, pixel, tecnologie)</li>
              <li>Generare pitch commerciali personalizzati tramite AI</li>
              <li>Esportare lead in formato CSV/Excel</li>
              <li>Integrare i dati con CRM e webhook esterni</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. Registrazione e Account</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Devi avere almeno 18 anni per creare un account</li>
              <li>Le informazioni di registrazione devono essere veritiere e aggiornate</li>
              <li>Sei responsabile della sicurezza delle tue credenziali di accesso</li>
              <li>Un account è personale e non può essere condiviso o trasferito</li>
              <li>Ci riserviamo il diritto di sospendere o terminare account in caso di violazione</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Piani e Crediti</h2>
            <p>Il Servizio è disponibile con i seguenti piani:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Esplora (gratuito):</strong> 10 crediti una tantum, tutte le funzionalità della piattaforma</li>
              <li><strong>Starter (€49/mese):</strong> 1.200 crediti/mese</li>
              <li><strong>PRO (€99/mese):</strong> 3.000 crediti/mese</li>
              <li><strong>Agency (€249/mese):</strong> 10.000 crediti/mese</li>
            </ul>
            <p className="mt-2">
              I crediti si rinnovano mensilmente alla data di sottoscrizione. I crediti non utilizzati
              non si accumulano al mese successivo. L&apos;utilizzo dei crediti è soggetto a fair use:
              è vietato l&apos;uso automatizzato o massivo non conforme al normale utilizzo della piattaforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Pagamenti e Fatturazione</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>I pagamenti sono elaborati tramite Stripe Inc., piattaforma PCI DSS compliant</li>
              <li>L&apos;abbonamento si rinnova automaticamente alla scadenza del periodo</li>
              <li>Puoi cancellare l&apos;abbonamento in qualsiasi momento dalla pagina Billing</li>
              <li>La cancellazione ha effetto alla fine del periodo corrente già pagato</li>
              <li>Non sono previsti rimborsi parziali per periodi non utilizzati, salvo quanto previsto dalla garanzia</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Garanzia Soddisfatti o Rimborsati</h2>
            <p>
              Offriamo una garanzia di 14 giorni dalla prima sottoscrizione di un piano a pagamento.
              Se non sei soddisfatto, puoi richiedere il rimborso completo scrivendo a{' '}
              <a href="mailto:supporto@miraxgroup.it" className="text-violet-600 hover:underline">supporto@miraxgroup.it</a>{' '}
              entro 14 giorni dalla data di acquisto.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Uso Consentito</h2>
            <p>Ti impegni a:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Utilizzare il Servizio solo per finalità commerciali lecite e conformi alla normativa vigente</li>
              <li>Non effettuare scraping, reverse engineering o accesso automatizzato non autorizzato</li>
              <li>Non utilizzare i dati ottenuti per spam, molestie o attività illegali</li>
              <li>Rispettare la normativa GDPR nel trattamento dei dati dei lead ottenuti</li>
              <li>Non rivendere, ridistribuire o sublicenziare l&apos;accesso al Servizio</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Proprietà Intellettuale</h2>
            <p>
              Tutti i contenuti, il software, i loghi, la grafica e i marchi presenti sulla piattaforma
              sono di proprietà esclusiva di MIRAX o dei rispettivi titolari. È vietata qualsiasi riproduzione,
              distribuzione o modifica non autorizzata.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Limitazione di Responsabilità</h2>
            <p>
              MIRAX fornisce il Servizio &quot;così com&apos;è&quot; (as is). Non garantiamo che:
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>I dati dei lead siano sempre completi, aggiornati o accurati al 100%</li>
              <li>Il Servizio sia disponibile senza interruzioni</li>
              <li>I risultati ottenuti portino a specifici risultati commerciali</li>
            </ul>
            <p className="mt-2">
              In nessun caso MIRAX sarà responsabile per danni indiretti, consequenziali, punitivi o
              perdite di profitto derivanti dall&apos;uso del Servizio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">10. Risoluzione</h2>
            <p>
              Possiamo sospendere o terminare il tuo accesso al Servizio in caso di violazione dei presenti Termini,
              uso fraudolento, mancato pagamento o a nostra ragionevole discrezione previo avviso.
              Puoi cancellare il tuo account in qualsiasi momento dalla pagina Profilo o contattandoci via email.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">11. Legge Applicabile e Foro Competente</h2>
            <p>
              I presenti Termini sono regolati dalla legge italiana.
              Per qualsiasi controversia sarà competente il Foro del luogo di residenza del consumatore,
              ove applicabile, o in alternativa il Foro di Milano.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">12. Contatti</h2>
            <p>
              Per domande relative ai presenti Termini, contattaci a{' '}
              <a href="mailto:supporto@miraxgroup.it" className="text-violet-600 hover:underline">supporto@miraxgroup.it</a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
