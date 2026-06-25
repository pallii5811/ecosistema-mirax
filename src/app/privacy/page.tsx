import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy | MIRAX',
  description: 'Informativa sulla privacy di MIRAX ai sensi del GDPR e del D.Lgs. 196/2003.',
}

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p className="text-sm text-slate-500 mb-10">Ultimo aggiornamento: {new Date().toLocaleDateString('it-IT')}</p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Titolare del Trattamento</h2>
            <p>
              Il Titolare del trattamento dei dati personali è <strong>MIRAX</strong> (di seguito &quot;Titolare&quot;),
              contattabile all&apos;indirizzo email: <a href="mailto:privacy@miraxgroup.it" className="text-violet-600 hover:underline">privacy@miraxgroup.it</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Dati raccolti</h2>
            <p>Raccogliamo le seguenti categorie di dati personali:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Dati di registrazione:</strong> indirizzo email e password (crittografata)</li>
              <li><strong>Dati di utilizzo:</strong> ricerche effettuate, lead visualizzati, crediti consumati</li>
              <li><strong>Dati tecnici:</strong> indirizzo IP, tipo di browser, sistema operativo, pagine visitate</li>
              <li><strong>Dati di pagamento:</strong> gestiti interamente da Stripe Inc. Non conserviamo dati di carte di credito</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. Finalità del Trattamento</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Erogazione del servizio (ricerca lead, audit tecnici, generazione pitch)</li>
              <li>Gestione dell&apos;account utente e dei crediti</li>
              <li>Comunicazioni di servizio (aggiornamenti, alert crediti, notifiche di sicurezza)</li>
              <li>Miglioramento del servizio tramite analisi aggregate e anonimizzate</li>
              <li>Adempimento degli obblighi di legge</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Base giuridica</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Esecuzione del contratto</strong> (Art. 6.1.b GDPR): per fornire il servizio richiesto</li>
              <li><strong>Consenso</strong> (Art. 6.1.a GDPR): per cookie analitici e comunicazioni marketing</li>
              <li><strong>Legittimo interesse</strong> (Art. 6.1.f GDPR): per sicurezza e prevenzione frodi</li>
              <li><strong>Obbligo legale</strong> (Art. 6.1.c GDPR): per adempimenti fiscali e normativi</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Conservazione dei dati</h2>
            <p>
              I dati personali sono conservati per il tempo strettamente necessario alle finalità per cui sono stati raccolti:
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Dati dell&apos;account: per tutta la durata del rapporto contrattuale + 10 anni per obblighi fiscali</li>
              <li>Dati di utilizzo: 24 mesi dalla raccolta</li>
              <li>Log di sicurezza: 12 mesi</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Condivisione dei dati</h2>
            <p>I dati personali possono essere condivisi con:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Supabase Inc.</strong> — hosting database e autenticazione (server EU)</li>
              <li><strong>Vercel Inc.</strong> — hosting applicazione web</li>
              <li><strong>Stripe Inc.</strong> — elaborazione pagamenti (PCI DSS compliant)</li>
              <li><strong>OpenAI Inc.</strong> — elaborazione AI per generazione pitch e analisi (dati anonimizzati)</li>
              <li><strong>Resend Inc.</strong> — invio email transazionali</li>
            </ul>
            <p className="mt-2">Non vendiamo, affittiamo o cediamo i dati personali a terze parti per fini di marketing.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Diritti dell&apos;interessato</h2>
            <p>Ai sensi degli articoli 15-22 del GDPR, hai diritto a:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Accesso ai tuoi dati personali</li>
              <li>Rettifica dei dati inesatti</li>
              <li>Cancellazione dei dati (&quot;diritto all&apos;oblio&quot;)</li>
              <li>Limitazione del trattamento</li>
              <li>Portabilità dei dati</li>
              <li>Opposizione al trattamento</li>
              <li>Revoca del consenso in qualsiasi momento</li>
            </ul>
            <p className="mt-2">
              Per esercitare i tuoi diritti, scrivi a{' '}
              <a href="mailto:privacy@miraxgroup.it" className="text-violet-600 hover:underline">privacy@miraxgroup.it</a>.
              Risponderemo entro 30 giorni.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Sicurezza</h2>
            <p>
              Adottiamo misure tecniche e organizzative adeguate per proteggere i dati personali, tra cui:
              crittografia TLS/SSL, hashing delle password, accesso basato su ruoli, backup cifrati e
              monitoraggio continuo delle infrastrutture.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Cookie</h2>
            <p>
              Per informazioni dettagliate sull&apos;uso dei cookie, consulta la nostra{' '}
              <Link href="/cookie-policy" className="text-violet-600 hover:underline">Cookie Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">10. Modifiche</h2>
            <p>
              Ci riserviamo il diritto di modificare questa informativa in qualsiasi momento.
              Le modifiche saranno pubblicate su questa pagina con aggiornamento della data.
              L&apos;uso continuato del servizio dopo la pubblicazione delle modifiche costituisce accettazione delle stesse.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">11. Contatti e Reclami</h2>
            <p>
              Per qualsiasi domanda relativa alla privacy, contattaci a{' '}
              <a href="mailto:privacy@miraxgroup.it" className="text-violet-600 hover:underline">privacy@miraxgroup.it</a>.
            </p>
            <p className="mt-2">
              Hai inoltre diritto di proporre reclamo al <strong>Garante per la Protezione dei Dati Personali</strong>{' '}
              (<a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">www.garanteprivacy.it</a>).
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
