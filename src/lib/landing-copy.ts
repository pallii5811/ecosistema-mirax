/** Copy condiviso landing — allineato al prodotto reale (single source of truth) */

export const LANDING = {
  positioning:
    'MIRAX è la piattaforma di sales automation B2B per l\'Italia: dal prospect qualificato al deal chiuso — ricerca AI, audit tecnico, scoring, pitch, outreach, sequenze e pipeline in un unico flusso.',

  hero: {
    eyebrow: 'Sales automation B2B · Italia',
    headline: 'Trova il cliente, contattalo, chiudi il deal.',
    headlineAccent: 'Tutto da un posto solo.',
    subtext:
      'MIRAX non ti dà una lista. Ti costruisce la macchina commerciale completa: ricerca AI con audit tecnico, lead scoring adattivo, pitch sul problema reale del sito, sequenze email multi-step e pipeline integrata. Dal primo contatto al contratto — senza cambiare tab.',
    coachLine:
      'Il Sales Command Center ti avvisa quando un deal sta perdendo calore e cosa fare adesso per recuperarlo.',
    trustLine: 'Ricerca → Audit → Score → Pitch → Outreach → Pipeline → Deal',
    proof: [
      { value: 'Ciclo chiuso', label: 'target al deal in-app' },
      { value: 'HOT 70+', label: '3× probabilità di chiusura' },
      { value: 'Human-in-the-loop', label: 'outreach anti-ban' },
    ] as const,
  },

  freeCredits: 10,
  freeCreditsLabel: '10 crediti gratis',
  creditRule: 'Un credito = un lead con telefono o email verificati',

  /** Ciclo commerciale end-to-end */
  cycle: {
    title: 'Il ciclo commerciale, chiuso dentro MIRAX.',
    subtitle:
      'Non esporti in HubSpot sperando che qualcosa succeda. Trovi, qualifichi, contatti e gestisci lo stesso lead — dalla ricerca alla firma.',
    steps: [
      'Ricerca AI',
      'Audit tecnico',
      'Score',
      'Pitch AI',
      'Outreach',
      'Pipeline',
      'Deal',
    ] as const,
  },

  /** Righe stile Glean — headline breve + mockup prodotto alternato */
  platformRows: [
    {
      id: 'command-center',
      headline: 'Sai quando un deal sta perdendo calore.',
      body:
        'Il Sales Command Center monitora pipeline e attività e ti propone la prossima mossa: proposte in attesa da troppo tempo, deal stagnanti, lead HOT mai contattati. Non un CRM passivo — un coach commerciale attivo.',
      mockup: 'command-center' as const,
    },
    {
      id: 'hotlist',
      headline: 'Contatta chi chiude davvero.',
      body:
        'La Lead Hotlist ordina i prospect dal più caldo al più freddo con score AI adattivo. Il modello impara dalle tue conversioni: i lead HOT (70+) hanno fino a 3× più probabilità di chiusura.',
      mockup: 'hotlist' as const,
    },
    {
      id: 'outreach',
      headline: 'Outbound con contesto, non a rischio spam.',
      body:
        'Genera pitch sul problema reale del sito, scegli il canale giusto (WhatsApp, email, Telegram, LinkedIn) e invia con guardrail: limite giornaliero, anti-duplicato 7 giorni e approvazione manuale di ogni messaggio.',
      mockup: 'outreach' as const,
    },
  ] as const,

  /** Tre pilastri — copy di supporto / FAQ */
  platform: {
    commandCenter: {
      title: 'Sales Command Center',
      headline: 'Un coach commerciale, non un CRM passivo.',
      body: 'Il sistema monitora pipeline e attività e ti propone azioni concrete: deal fermi, proposte senza follow-up, lead HOT mai contattati.',
      quote:
        'Una proposta che resta senza follow-up oltre 3 giorni perde il 50% di probabilità di chiusura. Chiama oggi.',
      quoteContext: 'Alert reale dal Sales Command Center',
    },
    hotlist: {
      title: 'Lead Hotlist',
      headline: 'Score adattivo: chi contattare per primo.',
      body: 'L\'AI ordina i lead dal più caldo al più freddo, impara dalle tue conversioni e migliora nel tempo. I lead HOT (70+) hanno fino a 3× più probabilità di chiusura.',
    },
    outreach: {
      title: 'Centro Outreach',
      headline: 'Outbound con guardrail, non a rischio blacklist.',
      body: 'Limite giornaliero anti-ban, anti-duplicato 7 giorni, approvazione manuale di ogni invio e log azione per azione. Pitch contestuale con canale suggerito: WhatsApp, email, Telegram o LinkedIn.',
      pills: ['Limite giornaliero', 'Anti-duplicato 7 gg', 'Human-in-the-loop', 'Log audit'] as const,
    },
    sequences: {
      title: 'Sequenze Email AI',
      headline: 'Nurturing multi-step, non un solo messaggio.',
      body: 'Genera campagne da 2 a 6 email personalizzate per ogni azienda target — tono, oggetto, corpo e CTA configurabili. Lancia la campagna senza uscire dalla piattaforma.',
    },
    ambiente: {
      title: 'Ambiente tematico',
      headline: 'Workspace per verticale o progetto.',
      body: 'Raggruppa ricerche correlate in un unico ambiente con lead, email e telefoni aggregati — una mappa semantica del tuo mercato, non solo una lista isolata.',
    },
  },

  /** Terminologia discovery — mai citare Google Maps in UI/copy */
  discovery: {
    engine: 'Discovery territoriale AI',
    engineShort: 'Discovery AI',
    scan: 'scansione intelligente del territorio',
    sources: 'directory commerciali, registri pubblici e fonti verificate in Italia',
    inputNode: 'Segnali territoriali',
    sourceRow: 'Profilo commerciale',
    territoryPill: 'Territorio',
    flow: 'dal target territoriale al deal in pipeline',
    findTitle: 'Trova nel territorio.',
    headline: 'ricerca semantica in italiano',
  },

  stats: {
    filters: '16+',
    filtersLabel: 'filtri tecnici su ogni ricerca',
    speed: '< 2 min',
    speedLabel: 'dal target al pitch pronto',
    creditRule: '1:1',
    creditRuleLabel: 'un credito = un lead con telefono o email',
    outreachWindow: '7 gg',
    outreachWindowLabel: 'anti-duplicato nel Centro Outreach',
  },

  dataSource:
    'Rete di segnali commerciali italiani — ricerca on-demand con audit del sito, non una lista statica acquistata.',

  integrations: 'Export CSV, HubSpot e webhook. API REST nel piano Agency.',

  gdpr:
    'Dati da fonti pubbliche, server in UE, privacy policy e diritto alla cancellazione. Progettato per il rispetto del GDPR.',
} as const
