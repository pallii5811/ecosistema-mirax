export type BuyingSignalSeverity = 'critical' | 'high' | 'medium'

export type BuyingSignalEvidence = {
  label: string
  value: string
  source: 'website_audit' | 'lead_data' | 'registry' | 'reviews' | 'ads' | 'contacts'
}

/**
 * Impatto quantificato di un segnale. Mai inventato: l'headline e la stima derivano da
 * dati REALI misurati sul lead, combinati con benchmark di settore pubblici e citabili.
 * `howToQuantifyLive` dà all'agenzia la formula per mettere un numero in euro sul tavolo
 * insieme al cliente (usando i SUOI dati: budget, traffico, scontrino medio), senza che noi
 * inventiamo cifre che non possiamo conoscere.
 */
export type BuyingSignalImpact = {
  headline: string
  estimate: string
  howToQuantifyLive: string
  benchmarkSource: string
}

export type BuyingSignal = {
  id: string
  title: string
  severity: BuyingSignalSeverity
  confidence: number
  category: 'budget' | 'tracking' | 'conversion' | 'competition' | 'reputation' | 'company_fit' | 'contactability'
  reason: string
  evidence: BuyingSignalEvidence[]
  serviceToSell: string
  openingLine: string
  nextBestAction: string
  quantifiedImpact?: BuyingSignalImpact
}

export type BuyingSignalSummary = {
  score: number
  label: 'freddo' | 'interessante' | 'caldo' | 'caldissimo'
  primaryReason: string
  strongestSignals: BuyingSignal[]
  signals: BuyingSignal[]
}

/**
 * Audit reale del sito (rilevato live, non stimato). Tutti i campi sono opzionali:
 * il motore usa solo ciò che è realmente disponibile, senza inventare nulla.
 */
export type BuyingSignalAudit = {
  metaPixel?: boolean
  googleAds?: boolean
  googleAnalytics?: boolean
  googleTagManager?: boolean
  contactFormCount?: number
  hasNewsletterForm?: boolean
  hasWhatsappButton?: boolean
  hasClickablePhone?: boolean
  hasClickableEmail?: boolean
  performanceScore?: number | null
  lcpMs?: number | null
  securityGrade?: string | null
  hasSsl?: boolean
  domainExpiresInDays?: number | null
  /** Inserzioni Meta ATTIVE trovate via API ufficiale (Ad Library). null = non verificato. */
  activeMetaAds?: number | null
  /** true se il conteggio inserzioni proviene dalla Meta Ad Library API ufficiale (FB_ADS_TOKEN). */
  metaAdsVerified?: boolean
}

type LeadRecord = Record<string, unknown>

function asRecord(value: unknown): LeadRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LeadRecord : {}
}

function readString(source: LeadRecord, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readNumber(source: LeadRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const normalized = Number(value.replace(',', '.').replace(/[^0-9.]/g, ''))
      if (Number.isFinite(normalized)) return normalized
    }
  }
  return null
}

function readBool(source: LeadRecord, keys: string[]): boolean | null {
  const technicalReport = asRecord(source.technical_report)
  const audit = asRecord(source.audit)
  const sources = [source, technicalReport, audit]
  for (const obj of sources) {
    for (const key of keys) {
      const value = obj[key]
      if (value === true) return true
      if (value === false) return false
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (['true', 'yes', 'si', 'sì', 'presente', 'detected'].includes(normalized)) return true
        if (['false', 'no', 'assente', 'missing', 'not detected'].includes(normalized)) return false
      }
    }
  }
  return null
}

function hasAnyText(source: LeadRecord, keys: string[]) {
  return Boolean(readString(source, keys))
}

function companyName(lead: LeadRecord) {
  return readString(lead, ['azienda', 'nome', 'business_name', 'company', 'name']) || 'questa azienda'
}

function legalFormEvidence(name: string, lead: LeadRecord) {
  const legalForm = readString(lead, ['forma_giuridica', 'legal_form', 'company_legal_form'])
  if (legalForm) return legalForm
  const match = name.match(/\b(s\.?r\.?l\.?s?|srls|srl|s\.?p\.?a\.?|spa|s\.?n\.?c\.?|snc|s\.?a\.?s\.?|sas|societa|società|cooperativa|coop)\b/i)
  return match?.[0] || ''
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function signalWeight(signal: BuyingSignal) {
  const severityWeight = signal.severity === 'critical' ? 34 : signal.severity === 'high' ? 24 : 14
  return severityWeight + Math.round(signal.confidence * 0.18)
}

// ── Benchmark pubblici e citabili (fonti reali, usate per quantificare con onestà) ──
const SRC_SPEED = 'Google/Deloitte — “Milliseconds Make Millions” (2020) e Google/SOASTA bounce study'
const SRC_TRACKING = 'Google — best practice conversion tracking / Smart Bidding'
const SRC_REVIEWS = 'M. Luca, Harvard Business School (2016) — “Reviews, Reputation and Revenue”'
const SRC_CONV_RATE = 'WordStream — Google Ads benchmark conversion rate (media ~3-5%)'
const SRC_SSL = 'Google Chrome — avviso “Sito non sicuro” su pagine senza HTTPS'
const SRC_ADS_LIVE = 'Meta Ad Library — registro pubblico ufficiale delle inserzioni attive'

/**
 * Costruisce l'impatto da una metrica di velocità REALE (secondi di caricamento o LCP).
 * Quantifica solo la distanza dalla soglia Google (2.5s) e applica un range pubblicato,
 * lasciando all'agenzia il calcolo in euro coi dati del cliente.
 */
function buildSpeedImpact(seconds: number, hasPaidTraffic: boolean): BuyingSignalImpact {
  const target = 2.5
  const over = Math.max(0, seconds - target)
  const overText = over > 0 ? `${over.toFixed(1)}s oltre la soglia Google di ${target}s` : 'al limite della soglia Google'
  // Google/SOASTA: la probabilità di abbandono cresce ~+32% (1s→3s) e ~+90% (1s→5s).
  const bounceText =
    seconds >= 5
      ? 'A questa velocità la probabilità di abbandono cresce di circa +90% rispetto a un sito veloce (Google/SOASTA).'
      : seconds >= 3
        ? 'A questa velocità la probabilità di abbandono cresce di circa +32% rispetto a un sito veloce (Google/SOASTA).'
        : 'Ogni decimo di secondo in più riduce le conversioni (Google/Deloitte: +0,1s mobile ≈ −8% conversioni retail).'
  return {
    headline: `Sito a ${seconds.toFixed(1)}s: ${overText}.`,
    estimate: `${bounceText}${hasPaidTraffic ? ' Con traffico a pagamento, questa perdita si applica direttamente al budget speso.' : ''}`,
    howToQuantifyLive: hasPaidTraffic
      ? 'Chiedi il budget ads mensile: applica anche solo −10/−20% di conversioni a quella cifra per mostrare la perdita in euro/mese.'
      : 'Chiedi quante richieste/contatti ricevono al mese: una parte si perde al caricamento. Stima il valore medio di un cliente per quantificare.',
    benchmarkSource: SRC_SPEED,
  }
}

function uniqueSignals(signals: BuyingSignal[]) {
  const seen = new Set<string>()
  return signals.filter((signal) => {
    if (seen.has(signal.id)) return false
    seen.add(signal.id)
    return true
  })
}

export function analyzeBuyingSignals(input: unknown, audit?: BuyingSignalAudit | null): BuyingSignalSummary {
  const lead = asRecord(input)
  const technicalReport = asRecord(lead.technical_report)
  const name = companyName(lead)
  const website = readString(lead, ['sito', 'website', 'url'])
  const email = readString(lead, ['email', 'mail'])
  const phone = readString(lead, ['telefono', 'phone', 'telephone'])
  const rating = readNumber(lead, ['rating', 'stelle', 'stars'])
  const reviewsCount = readNumber(lead, ['reviews_count', 'recensioni', 'review_count', 'reviews'])
  const loadSpeed = readNumber(lead, ['load_speed_seconds', 'load_speed_s']) ?? readNumber(technicalReport, ['load_speed_seconds', 'load_speed_s'])
  const employees = readNumber(lead, ['dipendenti', 'employees', 'dipendenti_stimati', 'employees_estimate'])
  const revenue = readString(lead, ['fatturato', 'revenue', 'turnover', 'ricavi'])
  const piva = readString(lead, ['partita_iva', 'piva', 'vat', 'vat_number'])
  const legalForm = legalFormEvidence(name, lead)

  // L'audit live (quando presente) è la fonte più affidabile: conferma la presenza reale on-site.
  const hasAds = readBool(lead, ['google_ads', 'has_google_ads', 'ads_running', 'has_ads']) === true || audit?.googleAds === true
  const hasPixel = readBool(lead, ['meta_pixel', 'has_pixel', 'has_facebook_pixel']) === true || audit?.metaPixel === true
  const hasGtm = readBool(lead, ['google_tag_manager', 'has_gtm', 'gtm']) === true || audit?.googleTagManager === true
  const hasAnalytics = readBool(lead, ['google_analytics', 'has_ga4', 'ga4', 'analytics']) === true || audit?.googleAnalytics === true
  const hasSsl = audit?.hasSsl === false ? false : readBool(lead, ['ssl', 'has_ssl'])
  const hasInstagram = hasAnyText(lead, ['instagram', 'ig', 'instagram_url', 'instagramUrl'])
  const hasFacebook = hasAnyText(lead, ['facebook', 'fb', 'facebook_url', 'facebookUrl'])
  const hasContact = Boolean(email || phone)
  const missingTracking = !hasGtm || !hasAnalytics || !hasPixel
  const noTrackingStack = !hasGtm && !hasAnalytics && !hasPixel
  const structuredCompany = Boolean(piva || legalForm || (employees !== null && employees >= 6) || revenue)

  // ── Audit reale del percorso di conversione (solo se disponibile) ──
  const hasAuditData = !!audit
  const adInfra = hasPixel || hasAds
  const formCount = typeof audit?.contactFormCount === 'number' ? audit.contactFormCount : null
  const whatsappBtn = audit?.hasWhatsappButton === true
  const clickablePhone = audit?.hasClickablePhone === true
  const clickableEmail = audit?.hasClickableEmail === true
  const perfScore = typeof audit?.performanceScore === 'number' ? audit.performanceScore : null
  const lcpMs = typeof audit?.lcpMs === 'number' ? audit.lcpMs : null
  // Percorso di contatto sul sito assente: nessun form, nessun telefono/whatsapp/email cliccabile.
  const noOnSiteCapture = hasAuditData && formCount === 0 && !whatsappBtn && !clickablePhone && !clickableEmail
  const slowRealSite = (perfScore !== null && perfScore < 50) || (lcpMs !== null && lcpMs > 4000)

  // Inserzioni Meta ATTIVE verificate via API ufficiale: prova certa di spesa pubblicitaria in corso.
  const metaAdsVerified =
    audit?.metaAdsVerified === true ||
    lead.meta_ads_verified === true ||
    technicalReport.meta_ads_verified === true
  const activeMetaAds =
    typeof audit?.activeMetaAds === 'number'
      ? audit.activeMetaAds
      : readNumber(lead, ['active_meta_ads', 'meta_ads_count']) ??
        readNumber(technicalReport, ['active_meta_ads', 'meta_ads_count'])
  const isAdvertisingNow = metaAdsVerified && activeMetaAds !== null && activeMetaAds > 0
  // Funnel rotto = il traffico (pagato) non si trasforma in contatti misurabili.
  const brokenFunnel = noOnSiteCapture || slowRealSite || noTrackingStack

  const signals: BuyingSignal[] = []

  // ══ SEGNALE TOP ASSOLUTO: sta investendo in ads Meta ORA (verificato da fonte ufficiale) ══
  if (isAdvertisingNow) {
    const adsCount = activeMetaAds as number
    const adsText = `${adsCount} inserzion${adsCount === 1 ? 'e attiva' : 'i attive'}`
    if (brokenFunnel) {
      const brokenBits = [
        noOnSiteCapture ? 'nessun form/contatto cliccabile sul sito' : '',
        slowRealSite ? 'sito lento misurato' : '',
        noTrackingStack ? 'nessun tracciamento conversioni' : '',
      ].filter(Boolean).join(', ')
      signals.push({
        id: 'active_meta_ads_broken_funnel',
        title: 'Sta investendo in ads Meta ORA, ma il funnel perde il budget',
        severity: 'critical',
        confidence: 98,
        category: 'budget',
        reason: 'Il segnale d’acquisto più forte possibile: la Libreria Inserzioni Meta conferma campagne ATTIVE in questo momento, ma il percorso di conversione è rotto. Significa che sta spendendo soldi reali ogni giorno su un sito che non trasforma il traffico in contatti.',
        evidence: [
          { label: 'Inserzioni Meta attive (API ufficiale)', value: adsText, source: 'ads' },
          { label: 'Problema sul funnel', value: brokenBits || 'percorso di conversione incompleto', source: 'website_audit' },
        ],
        serviceToSell: 'Ottimizzazione campagne + landing che converte + tracciamento conversioni (audit budget ads)',
        openingLine: `Ho visto che ${name} ha ${adsText} su Meta in questo momento: significa che state investendo. Il punto è che il sito dove arriva quel traffico ha un problema che fa perdere una parte di quei contatti — si può recuperare senza aumentare il budget.`,
        nextBestAction: 'Priorità assoluta: chiama oggi. Apri con la prova (Libreria Meta) e mostra il problema sul sito.',
        quantifiedImpact: {
          headline: `Budget pubblicitario speso ORA su un funnel che ne disperde una parte.`,
          estimate: `Con ${adsText} ma il percorso di conversione incompleto, una quota del budget genera click che non diventano contatti misurabili.`,
          howToQuantifyLive: 'Chiedi il budget Meta mensile: applica anche solo −15/−30% di efficacia per la perdita sul funnel = euro/mese recuperabili senza spendere di più.',
          benchmarkSource: SRC_ADS_LIVE,
        },
      })
    } else {
      signals.push({
        id: 'active_meta_ads_running',
        title: 'Sta investendo in ads Meta ORA (verificato)',
        severity: 'high',
        confidence: 94,
        category: 'budget',
        reason: 'La Libreria Inserzioni Meta conferma campagne ATTIVE in questo momento: l’azienda è già convinta del canale e ha un budget pubblicitario in corso. È un interlocutore caldo per gestione, ottimizzazione e scaling delle campagne.',
        evidence: [
          { label: 'Inserzioni Meta attive (API ufficiale)', value: adsText, source: 'ads' },
        ],
        serviceToSell: 'Gestione e ottimizzazione campagne Meta, creatività, scaling e reportistica conversioni',
        openingLine: `Ho visto che ${name} ha ${adsText} su Meta in questo momento: visto che già investite, posso analizzare le campagne e mostrarvi dove si può migliorare resa e costo per contatto.`,
        nextBestAction: 'Contatta con un mini-audit delle campagne attive: parti dalla prova nella Libreria Meta.',
        quantifiedImpact: {
          headline: 'Budget Meta già attivo: margine di ottimizzazione su costo per risultato.',
          estimate: 'Chi gestisce campagne in autonomia o con fornitori non specializzati lascia spesso sul tavolo efficienza su targeting, creatività e tracciamento.',
          howToQuantifyLive: 'Chiedi budget mensile e costo per lead attuale: anche un −10/−20% di costo per risultato si traduce subito in più contatti a parità di spesa.',
          benchmarkSource: SRC_ADS_LIVE,
        },
      })
    }
  }

  // ══ SEGNALE TOP: infrastruttura ads presente ma impossibile catturare contatti ══
  if (adInfra && noOnSiteCapture) {
    const infra = [hasPixel ? 'Meta Pixel rilevato' : '', hasAds ? 'tag Google Ads rilevato' : ''].filter(Boolean).join(' + ')
    signals.push({
      id: 'paid_infra_without_capture',
      title: 'Predisposti all’advertising ma sito incapace di catturare contatti',
      severity: 'critical',
      confidence: 96,
      category: 'conversion',
      reason: 'Segnale fortissimo e verificato: sul sito ci sono pixel/tag pubblicitari (quindi investono o vogliono investire in traffico), ma non esiste nessun modo per trasformare le visite in contatti. È budget che evapora.',
      evidence: [
        { label: 'Infrastruttura ads on-site', value: infra || 'rilevata', source: 'website_audit' },
        { label: 'Form di contatto', value: '0 sul sito', source: 'website_audit' },
        { label: 'Telefono/WhatsApp/Email cliccabili', value: 'nessuno rilevato', source: 'website_audit' },
      ],
      serviceToSell: 'Landing page con form, CTA, WhatsApp click-to-chat e tracciamento conversioni',
      openingLine: `Ho analizzato il sito di ${name}: avete già pixel/tag per la pubblicità, ma non c’è un form né un contatto cliccabile. Significa che il traffico che arriva non ha modo di diventare una richiesta: si possono recuperare contatti da subito.`,
      nextBestAction: 'Priorità massima: proponi una landing/percorso di contatto + tracciamento. Mostra lo screenshot del sito senza form.',
      quantifiedImpact: {
        headline: 'Il 100% del traffico che arriva non ha un modo diretto per lasciare un contatto.',
        estimate: 'Con pixel/tag attivo ma senza form né contatto cliccabile, la quota di visitatori che normalmente convertirebbe (in media ~2-5% su landing) è di fatto azzerata.',
        howToQuantifyLive: 'Chiedi quante visite/click ricevono al mese: moltiplica per una conversion rate prudente (2-3%) e per il valore medio di un cliente = richieste e fatturato persi ogni mese.',
        benchmarkSource: SRC_CONV_RATE,
      },
    })
  }

  // ══ Sito lento misurato realmente, con infrastruttura ads ══
  if (slowRealSite) {
    const evidence: BuyingSignalEvidence[] = []
    if (perfScore !== null) evidence.push({ label: 'Performance reale (PageSpeed)', value: `${perfScore}/100`, source: 'website_audit' })
    if (lcpMs !== null) evidence.push({ label: 'LCP', value: `${(lcpMs / 1000).toFixed(1)}s (target < 2.5s)`, source: 'website_audit' })
    if (adInfra) evidence.push({ label: 'Infrastruttura ads', value: hasPixel ? 'Meta Pixel rilevato' : 'tag Google Ads rilevato', source: 'website_audit' })
    signals.push({
      id: 'measured_slow_site',
      title: adInfra ? 'Sito lento (misurato) mentre investono in traffico' : 'Sito lento misurato realmente',
      severity: adInfra ? 'critical' : 'high',
      confidence: adInfra ? 91 : 80,
      category: 'conversion',
      reason: adInfra
        ? 'Dato misurato, non stimato: il sito è lento e contemporaneamente ci sono pixel/tag pubblicitari. Ogni secondo di lentezza brucia parte del budget e delle conversioni.'
        : 'Performance misurata bassa: una parte delle richieste si perde prima del contatto, soprattutto da mobile.',
      evidence,
      serviceToSell: 'Ottimizzazione performance, Core Web Vitals, landing veloci e CRO',
      openingLine: `Ho misurato le performance reali del sito di ${name}: è sotto la soglia critica. ${adInfra ? 'Con pixel/tag già attivi, ' : ''}velocizzarlo significa recuperare richieste che oggi si perdono al caricamento.`,
      nextBestAction: 'Invia il dato PageSpeed reale e proponi un intervento di ottimizzazione misurabile.',
      quantifiedImpact: lcpMs !== null
        ? buildSpeedImpact(lcpMs / 1000, adInfra)
        : {
            headline: `Performance ${perfScore}/100: sotto la soglia critica.`,
            estimate: 'Punteggio performance basso = caricamento lento percepito, con perdita di conversioni soprattutto da mobile.',
            howToQuantifyLive: adInfra
              ? 'Chiedi il budget ads/mese e applica una perdita conservativa di conversioni per stimare l’euro perso.'
              : 'Chiedi quanti contatti ricevono al mese: una parte si perde al caricamento.',
            benchmarkSource: SRC_SPEED,
          },
    })
  }

  // ══ Pixel attivo ma nessun analytics: spendono/tracciano per ads ma non misurano ══
  if (hasPixel && !hasAnalytics && !hasGtm) {
    signals.push({
      id: 'pixel_without_measurement',
      title: 'Pixel pubblicitario attivo ma nessuna misurazione',
      severity: 'high',
      confidence: 84,
      category: 'tracking',
      reason: 'Hanno un pixel pubblicitario sul sito ma né Analytics né Tag Manager: stanno costruendo audience per le ads senza poter misurare cosa funziona.',
      evidence: [
        { label: 'Meta Pixel', value: 'rilevato', source: 'website_audit' },
        { label: 'Analytics / GTM', value: 'non rilevati', source: 'website_audit' },
      ],
      serviceToSell: 'Setup GA4 + GTM, eventi di conversione e dashboard performance',
      openingLine: `${name} ha già il pixel pubblicitario sul sito, ma manca la misurazione (Analytics/GTM): state investendo senza sapere quali azioni portano risultati.`,
      nextBestAction: 'Proponi setup misurazione collegato al pixel già presente.',
      quantifiedImpact: {
        headline: 'Spesa pubblicitaria senza misurazione = ottimizzazione alla cieca.',
        estimate: 'Senza conversion tracking gli algoritmi (Smart Bidding/Advantage+) non ottimizzano sulle conversioni reali: secondo Google il tracking corretto è prerequisito per ridurre il costo per risultato.',
        howToQuantifyLive: 'Chiedi il budget ads/mese: anche solo un 15-20% di efficienza recuperabile su quella cifra è il risparmio/mese che puoi promettere di misurare.',
        benchmarkSource: SRC_TRACKING,
      },
    })
  }

  if (hasAds && missingTracking) {
    const missing = [!hasGtm ? 'GTM assente' : '', !hasAnalytics ? 'GA4/Analytics assente' : '', !hasPixel ? 'Meta Pixel assente' : ''].filter(Boolean)
    signals.push({
      id: 'paid_traffic_without_tracking',
      title: 'Budget advertising già attivo ma tracking incompleto',
      severity: 'critical',
      confidence: noTrackingStack ? 94 : 88,
      category: 'budget',
      reason: 'Questo è un segnale molto forte: l’azienda sembra già investire in traffico, ma non ha una base completa per misurare conversioni e ritorno delle campagne.',
      evidence: [
        { label: 'Google Ads rilevato', value: 'sì', source: 'ads' },
        { label: 'Tracking mancante', value: missing.join(', '), source: 'website_audit' },
      ],
      serviceToSell: 'Conversion tracking, GA4/GTM, audit campagne e ottimizzazione Ads',
      openingLine: `Ho visto che ${name} sembra investire in traffico, ma il sito non mostra un tracking conversioni completo: questo può far sprecare budget senza sapere quali campagne portano richieste reali.`,
      nextBestAction: phone ? 'Chiama oggi e proponi una verifica gratuita del tracking campagne.' : 'Invia una email breve con audit tracking e proposta di verifica gratuita.',
      quantifiedImpact: {
        headline: 'Budget speso senza poter attribuire le vendite alle campagne.',
        estimate: 'Senza tracking completo non si sa quali campagne/keyword generano richieste: secondo Google la misurazione corretta è la base per abbassare il costo per conversione.',
        howToQuantifyLive: 'Chiedi il budget ads/mese: stima un 15-20% oggi mal allocato come margine di recupero immediato e misurabile.',
        benchmarkSource: SRC_TRACKING,
      },
    })
  }

  if (structuredCompany && noTrackingStack) {
    const evidence: BuyingSignalEvidence[] = []
    if (piva) evidence.push({ label: 'P.IVA disponibile', value: piva, source: 'registry' })
    if (legalForm) evidence.push({ label: 'Forma societaria', value: legalForm, source: 'registry' })
    if (employees !== null) evidence.push({ label: 'Dipendenti stimati', value: String(employees), source: 'registry' })
    if (revenue) evidence.push({ label: 'Indicazione fatturato/ricavi', value: revenue, source: 'registry' })
    evidence.push({ label: 'Stack tracking', value: 'Pixel, GTM e Analytics non rilevati', source: 'website_audit' })
    signals.push({
      id: 'structured_company_tracking_gap',
      title: 'Azienda strutturata con base digitale misurabile debole',
      severity: 'high',
      confidence: piva || legalForm ? 86 : 76,
      category: 'company_fit',
      reason: 'Il problema non è solo tecnico: se l’azienda è strutturata, ha più probabilità di avere budget e processi commerciali migliorabili.',
      evidence,
      serviceToSell: 'Setup tracking, CRM/funnel, dashboard marketing e lead generation',
      openingLine: `${name} sembra una realtà strutturata, ma dal sito non emergono Pixel, GTM o Analytics: prima di aumentare marketing o vendite conviene rendere misurabile tutto il funnel.`,
      nextBestAction: 'Proponi un audit tecnico-commerciale focalizzato su misurazione e acquisizione lead.',
    })
  }

  if (loadSpeed !== null && loadSpeed >= 4 && (hasAds || hasContact || rating !== null)) {
    signals.push({
      id: 'slow_site_conversion_risk',
      title: 'Sito lento con rischio perdita richieste',
      severity: hasAds ? 'critical' : 'high',
      confidence: hasAds ? 90 : 78,
      category: 'conversion',
      reason: hasAds ? 'Se il traffico è a pagamento, ogni secondo di lentezza può trasformarsi in budget perso.' : 'Un sito lento riduce contatti, chiamate e compilazioni, soprattutto da mobile.',
      evidence: [
        { label: 'Velocità caricamento', value: `${loadSpeed.toFixed(1)} secondi`, source: 'website_audit' },
        ...(hasAds ? [{ label: 'Traffico a pagamento', value: 'Google Ads rilevato', source: 'ads' } satisfies BuyingSignalEvidence] : []),
      ],
      serviceToSell: 'Ottimizzazione performance, landing page, CRO e campagne',
      openingLine: `Il sito di ${name} carica in circa ${loadSpeed.toFixed(1)} secondi: se arrivano utenti da Google o campagne, una parte delle richieste può perdersi prima ancora del contatto.`,
      nextBestAction: 'Mostra il dato di velocità e proponi una landing o ottimizzazione performance orientata alle conversioni.',
      quantifiedImpact: buildSpeedImpact(loadSpeed, hasAds),
    })
  }

  if (rating !== null && rating >= 4.2 && reviewsCount !== null && reviewsCount >= 20 && noTrackingStack) {
    signals.push({
      id: 'strong_reputation_under_monetized',
      title: 'Reputazione forte ma acquisizione digitale poco misurata',
      severity: 'high',
      confidence: 82,
      category: 'reputation',
      reason: 'Una buona reputazione è leva commerciale reale: se il sito non traccia e non alimenta funnel, l’azienda può non monetizzare tutta la fiducia già presente.',
      evidence: [
        { label: 'Rating', value: `${rating}/5`, source: 'reviews' },
        { label: 'Recensioni', value: String(reviewsCount), source: 'reviews' },
        { label: 'Tracking', value: 'Pixel, GTM e Analytics non rilevati', source: 'website_audit' },
      ],
      serviceToSell: 'Campagne local, landing, remarketing e raccolta lead',
      openingLine: `${name} ha una reputazione online forte, ma il sito non mostra una base di tracking completa: si può trasformare quella fiducia in più richieste misurabili.`,
      nextBestAction: 'Contatta con angolo “trasformiamo le recensioni positive in nuove richieste”.',
      quantifiedImpact: {
        headline: `Reputazione forte (${rating}/5 su ${reviewsCount} recensioni) non sfruttata in acquisizione.`,
        estimate: 'Studi Harvard (Luca, 2016): +1 stella di rating ≈ +5-9% di fatturato per le PMI locali. La fiducia c’è già, ma non è incanalata in un funnel misurabile.',
        howToQuantifyLive: 'Stima quante richieste extra/mese giustificano il servizio e confrontale col volume di recensioni positive già ottenute.',
        benchmarkSource: SRC_REVIEWS,
      },
    })
  }

  if (website && !hasContact) {
    signals.push({
      id: 'contact_friction',
      title: 'Attrito nel contatto commerciale',
      severity: 'medium',
      confidence: 68,
      category: 'contactability',
      reason: 'Se il lead è interessante ma mancano contatti immediati nel dato raccolto, conviene proporre miglioramenti su CTA, form e canali diretti.',
      evidence: [
        { label: 'Sito presente', value: website, source: 'lead_data' },
        { label: 'Contatti nel lead', value: 'telefono/email non disponibili', source: 'contacts' },
      ],
      serviceToSell: 'CTA, form, WhatsApp click-to-chat, landing e automazioni risposta',
      openingLine: `Ho analizzato ${name}: il sito c’è, ma i contatti diretti non emergono subito nei dati raccolti. Rendere il contatto più immediato può aumentare le richieste.`,
      nextBestAction: 'Verifica manualmente la pagina contatti e proponi ottimizzazione CTA/form.',
    })
  }

  if (hasAds && loadSpeed !== null && loadSpeed >= 3.2 && noTrackingStack) {
    signals.push({
      id: 'paid_traffic_landing_leak',
      title: 'Traffico a pagamento con possibile perdita sulla landing',
      severity: 'critical',
      confidence: 92,
      category: 'conversion',
      reason: 'Combinazione molto calda: spesa pubblicitaria, tracking assente e performance non ottimale indicano una possibile perdita economica immediata.',
      evidence: [
        { label: 'Google Ads rilevato', value: 'sì', source: 'ads' },
        { label: 'Tracking', value: 'Pixel, GTM e Analytics non rilevati', source: 'website_audit' },
        { label: 'Velocità', value: `${loadSpeed.toFixed(1)} secondi`, source: 'website_audit' },
      ],
      serviceToSell: 'Audit landing, tracking conversioni, CRO e ottimizzazione campagne',
      openingLine: `${name} sembra avere traffico a pagamento, ma landing lenta e tracking assente: è il classico caso in cui una parte del budget può uscire senza generare richieste misurabili.`,
      nextBestAction: 'Priorità massima: chiama o invia video-audit breve entro oggi.',
      quantifiedImpact: buildSpeedImpact(loadSpeed, true),
    })
  }

  if (!hasInstagram && !hasFacebook && rating !== null && rating >= 4 && reviewsCount !== null && reviewsCount >= 15) {
    signals.push({
      id: 'local_reputation_social_gap',
      title: 'Reputazione locale già presente ma social deboli',
      severity: 'medium',
      confidence: 72,
      category: 'reputation',
      reason: 'La prova sociale esiste già nelle recensioni: un social media manager può trasformarla in contenuti, campagne locali e remarketing.',
      evidence: [
        { label: 'Rating', value: `${rating}/5`, source: 'reviews' },
        { label: 'Recensioni', value: String(reviewsCount), source: 'reviews' },
        { label: 'Social rilevati', value: 'Instagram/Facebook non presenti nel lead', source: 'lead_data' },
      ],
      serviceToSell: 'Social media management, contenuti recensioni, campagne local awareness',
      openingLine: `${name} ha già prova sociale dalle recensioni, ma non emergono canali social forti: si può usare quella reputazione per generare più fiducia e richieste.`,
      nextBestAction: 'Proponi piano contenuti basato su recensioni e campagne locali leggere.',
    })
  }

  if (hasSsl === false) {
    signals.push({
      id: 'trust_blocker_no_ssl',
      title: 'Blocco fiducia sul sito: SSL assente o non valido',
      severity: 'high',
      confidence: 84,
      category: 'conversion',
      reason: 'Un sito non sicuro abbassa fiducia e conversioni, soprattutto se l’utente deve compilare form o inviare dati.',
      evidence: [{ label: 'SSL', value: 'non rilevato / non valido', source: 'website_audit' }],
      serviceToSell: 'Messa in sicurezza sito, manutenzione web e ottimizzazione conversioni',
      openingLine: `Sul sito di ${name} emerge un problema di sicurezza SSL: prima di fare campagne o acquisizione, questo può bloccare fiducia e richieste.`,
      nextBestAction: 'Contatta con proposta rapida di fix tecnico e mini audit sito.',
      quantifiedImpact: {
        headline: 'Browser mostrano “Sito non sicuro”: abbandono immediato sui form.',
        estimate: 'Chrome/Firefox segnalano le pagine senza HTTPS come non sicure, soprattutto dove si inseriscono dati: gli utenti abbandonano prima di compilare.',
        howToQuantifyLive: 'Mostra l’avviso “Non sicuro” al cliente sul suo stesso sito: prova immediata e a costo zero per chiudere il fix.',
        benchmarkSource: SRC_SSL,
      },
    })
  }

  const sortedSignals = uniqueSignals(signals).sort((a, b) => {
    const severityRank = { critical: 0, high: 1, medium: 2 }
    return severityRank[a.severity] - severityRank[b.severity] || b.confidence - a.confidence
  })
  const score = clampScore(sortedSignals.reduce((sum, signal) => sum + signalWeight(signal), 0))
  const label = score >= 80 ? 'caldissimo' : score >= 60 ? 'caldo' : score >= 35 ? 'interessante' : 'freddo'
  const strongestSignals = sortedSignals.slice(0, 3)
  const primaryReason = strongestSignals[0]?.title || 'Nessun segnale d’acquisto forte verificabile con i dati disponibili.'

  return {
    score,
    label,
    primaryReason,
    strongestSignals,
    signals: sortedSignals,
  }
}

/**
 * Costruisce un messaggio di primo contatto PRONTO DA COPIARE, interamente derivato dai
 * segnali d'acquisto reali del lead. Niente claim inventati: ogni riga nasce da una prova
 * misurata (audit sito, dati registro) o da un benchmark pubblico già citato nel segnale.
 *
 * Struttura: apertura contestuale → 1-3 problemi concreti con prova → impatto sul business
 * (se quantificato) → proposta di valore → call to action soft. Pensato per email/WhatsApp/DM.
 *
 * `contactName` (opzionale) personalizza il saluto; in sua assenza si usa un saluto neutro.
 */
export function buildPitchMessage(
  summary: BuyingSignalSummary,
  opts?: { company?: string; contactName?: string; agencyName?: string },
): string {
  const company = (opts?.company || '').trim()
  const contact = (opts?.contactName || '').trim()
  const agency = (opts?.agencyName || '').trim()

  const top = summary.strongestSignals.length > 0 ? summary.strongestSignals : summary.signals.slice(0, 3)
  if (top.length === 0) {
    return ''
  }

  const greeting = contact ? `Ciao ${contact},` : 'Salve,'
  const lead = top[0]

  const lines: string[] = []
  lines.push(greeting)
  lines.push('')

  // Apertura: contestualizza sul lead reale, riusando la frase d'apertura del segnale principale.
  const intro = company
    ? lead.openingLine.replace(/\bquesta azienda\b/gi, company)
    : lead.openingLine
  lines.push(intro)
  lines.push('')

  // Problemi concreti con prova verificabile (max 3, dai segnali più forti).
  lines.push('In pratica, analizzando i dati pubblici e tecnici è emerso questo:')
  top.slice(0, 3).forEach((signal) => {
    const proof = signal.evidence[0]
    const proofText = proof ? ` (${proof.label}: ${proof.value})` : ''
    lines.push(`• ${signal.title}${proofText}`)
  })
  lines.push('')

  // Impatto sul business, solo se quantificato su dati reali.
  const impact = top.find((s) => s.quantifiedImpact)?.quantifiedImpact
  if (impact) {
    lines.push(`Cosa significa concretamente: ${impact.headline}`)
    lines.push('')
  }

  // Proposta di valore: cosa possiamo fare, dal servizio del segnale principale.
  lines.push(
    `Mi occupo di ${lead.serviceToSell.toLowerCase()} e in casi simili interveniamo proprio su questi punti per trasformarli in più richieste e clienti.`,
  )
  lines.push('')

  // Call to action soft.
  lines.push(
    'Se ti va, ti preparo una breve analisi gratuita con i numeri specifici della tua attività: bastano 10 minuti. Quando saresti disponibile?',
  )

  if (agency) {
    lines.push('')
    lines.push(agency)
  }

  return lines.join('\n')
}

// Tipi unificati MIRAX (Fase 1-A) — implementazione in src/lib/mirax-signals.ts
export type { MiraxSignal, MiraxSignalKind, MiraxSignalSummary } from '@/lib/mirax-signals'
