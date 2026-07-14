/**
 * UQE Step 4.1 — AI Planner con Tool Calling (OpenAI / Anthropic).
 * Traduce linguaggio naturale → MiraxQueryPlan tipizzato.
 */
import {
  createFallbackPlan,
  DEFAULT_EXTRACTION_SCHEMA,
  UQE_SIGNAL_ALIASES,
  UqePlannerError,
  type MiraxQueryPlan,
  type UqeSourceLane,
  type UqeSourcePlanItem,
  type UqeParseSource,
  type UqeCommercialHypothesis,
  type UqeRankingPolicy,
  type UqeSearchStrategy,
} from '@/types/uqe'
import { parseSignalIntentHeuristic } from '@/lib/signal-intent/parse-heuristic'
import {
  isBuyerMarketingInvestmentQuery,
  isSellerMarketingAgencySector,
} from '@/lib/signal-intent/marketing-investment'
import {
  compileCommercialSearchPlan,
  detectQueryContradictions,
  type CommercialIntentCompilerOptions,
} from '@/lib/intent-compiler/compile-commercial-search-plan'
import type { CommercialSearchPlan } from '@/lib/contracts/commercial-search-plan'
import { sourceSupportsSignal } from '@/lib/source-intelligence/registry'
import { canonicalSignalId, getSignalDefinition } from '@/lib/signal-ontology/ontology'
import { SOURCE_CAPABILITY_REGISTRY } from '@/lib/source-adapters/catalog'

const MIRAX_QUERY_PLAN_TOOL_NAME = 'submit_mirax_query_plan'

const SYSTEM_PROMPT = `Sei il motore strategico commerciale evidence-first di MIRAX. Ragiona come un team composto da esperto di marketing B2B, sales intelligence, data engineering, scouting e outreach. La query originale dell'utente e il vincolo dominante: non sostituirla con un target generico.

METODO OBBLIGATORIO:
1. Distingui cio che l'utente VENDE dal tipo di azienda che dovrebbe COMPRARLO. Non usare automaticamente il prodotto venduto come settore target.
2. Traduci l'offerta in problemi/costi che risolve, ICP plausibile, buying committee e segnali d'acquisto osservabili adesso.
3. Trasforma i segnali in fatti verificabili (annuncio di lavoro, outbound, nuova pipeline, gara, round, nuova sede, cambio tecnologia), fonti e domande di ricerca.
4. Dai priorita ai segnali piu vicini alla spesa: espliciti, recenti, specifici e supportati da URL/data. Popolarita o crescita generica non bastano.
5. Pensa alle miniere d'oro: annunci hiring, ads attivi/landing, gare/albi, recensioni negative o pain pubblici, fiere/eventi, partnership/canali, marketplace/directory, compliance/scadenze, sito ufficiale e stack tecnologico.
6. Definisci disqualifier e ranking. Un lead senza prova non e "caldo".
7. Richiedi dal sito ufficiale tutti i dati utili e pubblici: contatti business, social, decision maker, tecnologie, criticita e contesto per l'outreach.

ESEMPIO: se l'utente vende lead generation/Sales Intelligence, cerca aziende che stanno assumendo SDR/BDR/Inside Sales/Business Developer, citano outbound, prospecting, sviluppo nuovi clienti o gestione pipeline. Non cercare genericamente aziende software e non usare funding come prova sufficiente da solo.

ANTI-ALLUCINAZIONE: non inventare aziende o segnali. commercial_hypothesis e un'ipotesi di ricerca; ogni lead dovra poi avere evidence, source_url ed evidence_date quando disponibile.

REGOLE DI ROUTING (CRITICHE):
1. maps — categoria fisica + città (es. 'imprese edili a Genova', 'ristoranti Milano', 'imprese di pulizie a Otranto') O filtri tecnici sul sito (es. 'senza pixel', 'con errori SEO').
2. hybrid — settore + geo espliciti con segnali secondari (es. 'hotel a Roma in espansione'). NON usare hybrid per intenti puramente basati su segnale d'acquisto senza categoria Maps.
3. organic_web_search — (A) intento venditore/servizio astratto (es. 'sono commercialista cerco clienti') OPPURE (B) ricerca per SEGNALI D'ACQUISTO sul web (es. 'aziende che investono in marketing', 'stanno assumendo', 'hanno vinto gare', 'in fase di espansione'). Per (B) il worker usa WebResearcher (articoli, comunicati) — NON Google Maps.

Devi SEMPRE chiamare submit_mirax_query_plan con tutti i campi richiesti, inclusi commercial_hypothesis e ranking_policy.
- sector: settore/categoria target dedotto dalla query.
- location: città/regione se esplicita, altrimenti "" o "Italia".
- required_signals: es. hiring, new_company, funding_received, expansion, no_pixel.
- technical_filters: has_meta_pixel, has_gtm, technologies, ecc. se richiesti.
- extraction_schema: email, telefono, sito, azienda, …
Se unmappable: is_unmappable=true + user_message in italiano.`

const OPENAI_TOOL_SCHEMA = {
  type: 'function' as const,
  function: {
    name: MIRAX_QUERY_PLAN_TOOL_NAME,
    description: 'Invia il piano di ricerca MIRAX strutturato.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        search_strategy: {
          type: 'string',
          enum: ['graph', 'maps', 'hybrid', 'organic_web_search'],
          description: 'Motore di esecuzione primario.',
        },
        sector: { type: 'string', description: 'Settore/categoria target.' },
        location: { type: 'string', description: 'Località geografica.' },
        required_signals: {
          type: 'array',
          items: { type: 'string' },
          description: "Segnali d'acquisto richiesti.",
        },
        technical_filters: {
          type: 'object',
          additionalProperties: true,
          description: 'Filtri tecnologici (has_meta_pixel, technologies, ...).',
        },
        extraction_schema: {
          type: 'array',
          items: { type: 'string' },
          description: 'Campi da estrarre per ogni lead.',
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        intent_summary: { type: 'string', description: "Sintesi breve in italiano per l'utente." },
        reasoning: { type: 'string', description: 'Spiegazione del ragionamento.' },
        is_unmappable: {
          type: 'boolean',
          description: 'True se la query non può essere eseguita.',
        },
        user_message: {
          type: 'string',
          description: "Messaggio per l'utente se unmappable o chiarimento necessario.",
        },
        research_questions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Domande fattuali che la ricerca deve provare.',
        },
        source_plan: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              lane: {
                type: 'string',
                enum: [
                  'public_registry', 'public_procurement', 'job_market', 'funding',
                  'company_web', 'news', 'technology', 'real_estate', 'regulatory',
                  'ads', 'reviews', 'events', 'marketplace', 'partnerships', 'compliance',
                  'web_evidence',
                ],
              },
              source_types: { type: 'array', items: { type: 'string' } },
              query_templates: { type: 'array', items: { type: 'string' } },
              expected_evidence: { type: 'array', items: { type: 'string' } },
              priority: { type: 'number', minimum: 1, maximum: 100 },
              llm_required: { type: 'boolean' },
            },
            required: ['lane', 'source_types', 'query_templates', 'expected_evidence', 'priority', 'llm_required'],
          },
          description: 'Piano fonti ordinato per valore e costo.',
        },
        commercial_hypothesis: {
          type: 'object',
          additionalProperties: false,
          properties: {
            offer: { type: 'string' },
            target_profile: { type: 'array', items: { type: 'string' } },
            buyer_pains: { type: 'array', items: { type: 'string' } },
            buying_signals: { type: 'array', items: { type: 'string' } },
            hiring_roles: { type: 'array', items: { type: 'string' } },
            decision_maker_roles: { type: 'array', items: { type: 'string' } },
            disqualifiers: { type: 'array', items: { type: 'string' } },
          },
          required: ['offer', 'target_profile', 'buyer_pains', 'buying_signals', 'hiring_roles', 'decision_maker_roles', 'disqualifiers'],
        },
        ranking_policy: {
          type: 'object',
          additionalProperties: false,
          properties: {
            signal_match_mode: { type: 'string', enum: ['any', 'all'] },
            max_signal_age_days: { type: 'number', minimum: 1, maximum: 1825 },
            require_concrete_evidence: { type: 'boolean' },
            weights: {
              type: 'object',
              additionalProperties: false,
              properties: {
                intent_fit: { type: 'number', minimum: 0, maximum: 1 },
                signal_strength: { type: 'number', minimum: 0, maximum: 1 },
                recency: { type: 'number', minimum: 0, maximum: 1 },
                evidence_quality: { type: 'number', minimum: 0, maximum: 1 },
                contactability: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['intent_fit', 'signal_strength', 'recency', 'evidence_quality', 'contactability'],
            },
          },
          required: ['signal_match_mode', 'max_signal_age_days', 'require_concrete_evidence', 'weights'],
        },
      },
      required: [
        'search_strategy',
        'sector',
        'location',
        'required_signals',
        'technical_filters',
        'extraction_schema',
        'confidence',
        'intent_summary',
        'is_unmappable',
        'commercial_hypothesis',
        'ranking_policy',
      ],
    },
  },
}

const ANTHROPIC_TOOL_SCHEMA = {
  name: MIRAX_QUERY_PLAN_TOOL_NAME,
  description: 'Invia il piano di ricerca MIRAX strutturato.',
  input_schema: OPENAI_TOOL_SCHEMA.function.parameters,
}

type RawToolPlan = {
  search_strategy?: string
  sector?: string
  location?: string
  required_signals?: unknown
  technical_filters?: unknown
  extraction_schema?: unknown
  confidence?: unknown
  intent_summary?: string
  reasoning?: string
  is_unmappable?: boolean
  user_message?: string
  research_questions?: unknown
  source_plan?: unknown
  commercial_hypothesis?: unknown
  ranking_policy?: unknown
}

const VALID_SOURCE_LANES = new Set<UqeSourceLane>([
  'public_registry', 'public_procurement', 'job_market', 'funding', 'company_web',
  'news', 'technology', 'real_estate', 'regulatory', 'ads', 'reviews', 'events',
  'marketplace', 'partnerships', 'compliance', 'web_evidence',
])

function defaultSourcePlan(query: string, signals: string[]): UqeSourcePlanItem[] {
  const lanes: UqeSourcePlanItem[] = []
  const add = (
    lane: UqeSourceLane,
    sourceTypes: string[],
    expectedEvidence: string[],
    llmRequired = false,
  ) => {
    if (lanes.some((item) => item.lane === lane)) return
    lanes.push({
      lane,
      source_types: sourceTypes,
      query_templates: [query],
      expected_evidence: expectedEvidence,
      priority: Math.max(1, 100 - lanes.length * 10),
      llm_required: llmRequired,
    })
  }
  if (signals.includes('tender_won')) {
    add('public_procurement', ['public_procurement_portal'], ['tender_won'])
  }
  if (signals.some((signal) => signal === 'hiring' || signal.startsWith('hiring_'))) {
    add(
      'job_market',
      ['company_careers', 'job_board'],
      signals.filter((signal) => signal === 'hiring' || signal.startsWith('hiring_')),
    )
  }
  if (signals.some((signal) => ['funding', 'funding_received'].includes(signal))) {
    add('funding', ['registri investimenti', 'comunicati', 'database startup'], ['azienda', 'round/importo', 'data'])
  }
  if (signals.some((signal) => ['registry_change', 'new_company', 'executive_change'].includes(signal))) {
    add('public_registry', ['registro imprese', 'albo pubblico', 'comunicati societari'], ['identita legale', 'evento', 'data'])
  }
  if (signals.some((signal) => ['crm_change', 'tech_migration', 'no_pixel', 'site_stale'].includes(signal))) {
    add('technology', ['sito ufficiale', 'job posting tecnici', 'case study fornitore'], ['dominio ufficiale', 'tecnologia', 'evidenza'])
  }
  if (signals.some((signal) => ['investing_marketing', 'meta_ads_started', 'google_ads_started'].includes(signal))) {
    add(
      'ads',
      ['Meta Ad Library', 'Google Ads Transparency Center', 'landing page', 'tag di tracking'],
      ['inserzione/campagna attiva', 'pagina o creatività', 'dominio ufficiale', 'data quando disponibile'],
      true,
    )
    add(
      'technology',
      ['sito ufficiale', 'tag manager', 'pixel', 'landing page'],
      ['pixel/tag ads', 'form lead', 'call tracking o CTA commerciale'],
    )
  }
  if (signals.some((signal) => ['seeking_supplier', 'tender_won'].includes(signal))) {
    add('compliance', ['bandi', 'albi fornitori', 'normative di settore'], ['bisogno/obbligo', 'scadenza o data', 'ente/azienda'])
  }
  if (signals.some((signal) => ['new_product', 'market_entry', 'executive_change', 'investing_expansion'].includes(signal))) {
    add('events', ['fiere', 'webinar', 'conferenze', 'sponsor eventi'], ['azienda', 'evento/lancio', 'data', 'tema investimento'], true)
    add('partnerships', ['comunicati partnership', 'canale vendita', 'reseller/partner'], ['azienda', 'partner/canale', 'data', 'obiettivo commerciale'], true)
  }
  if (signals.includes('expansion')) {
    add('real_estate', ['permessi', 'immobili commerciali', 'comunicati apertura'], ['azienda', 'nuova sede/apertura', 'data'])
    add('events', ['fiere', 'eventi locali', 'comunicati espansione'], ['azienda', 'evento/espansione', 'data'], true)
    add('partnerships', ['rete vendita', 'nuovi partner', 'accordi commerciali'], ['azienda', 'accordo commerciale', 'data'], true)
  }
  if (/recension|review|trustpilot|stelle|lament|reputazione/i.test(query)) {
    add('reviews', ['Google reviews', 'Trustpilot', 'Tripadvisor', 'Glassdoor', 'recensioni locali'], ['rating', 'tema criticità', 'data recensione'], true)
  }
  add('news', ['recognized_local_news', 'industry_publication'], signals, true)
  add('company_web', ['official_company_website'], signals)
  add('web_evidence', ['search_snippet'], signals, true)
  return lanes
}

function normalizeSourcePlan(raw: unknown, query: string, signals: string[]): UqeSourcePlanItem[] {
  if (!Array.isArray(raw)) return defaultSourcePlan(query, signals)
  const normalized: UqeSourcePlanItem[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    const lane = String(item.lane || '') as UqeSourceLane
    if (!VALID_SOURCE_LANES.has(lane)) continue
    normalized.push({
      lane,
      source_types: asStringArray(item.source_types),
      query_templates: asStringArray(item.query_templates),
      expected_evidence: asStringArray(item.expected_evidence),
      priority: Math.max(1, Math.min(100, Number(item.priority) || 50)),
      llm_required: item.llm_required === true,
    })
  }
  return normalized.length ? normalized.sort((a, b) => b.priority - a.priority) : defaultSourcePlan(query, signals)
}

type SellerPlaybookKind =
  | 'sales_intelligence'
  | 'accounting_tax'
  | 'workplace_safety'
  | 'insurance_broker'
  | 'web_agency'
  | 'software_development'
  | 'generic_consulting'

type SellerPlaybookDefaults = {
  sector: string
  location: string
  signals?: string[]
  summary: string
  research_questions: string[]
  reasoning: string
}

function classifySellerPlaybook(query: string, hypothesis?: UqeCommercialHypothesis): SellerPlaybookKind | null {
  const blob = `${query} ${hypothesis?.offer || ''} ${(hypothesis?.target_profile || []).join(' ')} ${(hypothesis?.buying_signals || []).join(' ')}`.toLowerCase()
  const seller = isSellerAbstractQuery(query) || Boolean(hypothesis?.offer)
  if (!seller) return null
  if (/\b(lead\s*generation|leadgen|sales\s*intelligence|prospecting|outbound|generazione\s+lead)\b/i.test(blob)) {
    return 'sales_intelligence'
  }
  if (/\b(commercialist\w*|ragionier\w*|contabil\w*|fiscal\w*|paghe|payroll|dichiarazion\w*\s+fiscal|bilancio|consulenza\s+fiscale)\b/i.test(blob)) {
    return 'accounting_tax'
  }
  if (/\b(?:consulente|consulenza|vendo|offro|fornisco|servizi(?:\s+di)?)\b[^.]{0,100}\b(?:sicurezza\s+(?:sul\s+)?lavoro|hse)\b/i.test(blob)) {
    return 'workplace_safety'
  }
  if (/\b(broker\s+assicur|assicurazion|polizze?|rc\s*(?:auto|professionale|aziendale)?|rischi?\s+aziendal|welfare|infortuni|responsabilit\w*)\b/i.test(blob)) {
    return 'insurance_broker'
  }
  if (/\b(web\s*agency|agenzia\s+web|rifare\s+il\s+sito|sito\s+web|ecommerce|shopify|seo\b|google\s+ads|meta\s+ads|marketing\s+digitale|social\s+media|performance\s+marketing)\b/i.test(blob)) {
    return 'web_agency'
  }
  if (/\b(programmatore|developer|sviluppat\w*|software\s+engineer|full[\s-]?stack|app\b|saas|software\s+su\s+misura)\b/i.test(blob)) {
    return 'software_development'
  }
  if (seller) return 'generic_consulting'
  return null
}

function sellerPlaybookDefaults(
  query: string,
  hypothesis?: UqeCommercialHypothesis,
): SellerPlaybookDefaults | null {
  const kind = classifySellerPlaybook(query, hypothesis)
  if (!kind) return null
  const location = 'Italia'
  if (kind === 'sales_intelligence') {
    return {
      sector: 'PMI B2B con team commerciale in espansione',
      location,
      signals: ['hiring', 'expansion'],
      summary: 'PMI B2B che stanno investendo in sviluppo commerciale, outbound o nuova pipeline.',
      research_questions: [
        'Quali PMI stanno assumendo ruoli SDR/BDR/Business Developer o Sales Account new business?',
        'Quale fonte prova outbound, prospecting, pipeline o sviluppo nuovi clienti?',
        'Il segnale e recente, specifico e collegabile a un decisore sales/revenue?',
      ],
      reasoning: 'Seller-to-buyer reasoning: lead generation/sales intelligence -> dolore prospecting/pipeline -> segnali hiring sales/outbound/espansione commerciale.',
    }
  }
  if (kind === 'accounting_tax') {
    return {
      sector: 'PMI, nuove societa e attivita in crescita con bisogno amministrativo/fiscale',
      location,
      signals: ['new_company', 'registry_change', 'hiring', 'expansion'],
      summary: 'Clienti caldi per commercialista: nuove societa, aperture, crescita organico o complessita amministrativa.',
      research_questions: [
        'Quali nuove societa, aperture o startup hanno appena iniziato attivita e devono strutturare contabilita/fisco?',
        'Quali PMI stanno assumendo amministrazione, contabile, back office o payroll?',
        'Quali aziende hanno espansione, nuova sede, ecommerce o crescita che aumenta complessita fiscale/amministrativa?',
      ],
      reasoning: 'Seller-to-buyer reasoning: commercialista -> trigger di contabilita/fisco/paghe -> nuove aziende, crescita, hiring admin e cambi societari.',
    }
  }
  if (kind === 'insurance_broker') {
    return {
      sector: 'PMI con rischio assicurabile, crescita operativa, personale, mezzi o appalti',
      location,
      signals: ['hiring', 'expansion', 'tender_won', 'new_company', 'regulatory'],
      summary: 'Clienti caldi per broker assicurativo: aziende che stanno crescendo, assumendo, vincendo appalti o aumentando rischi operativi.',
      research_questions: [
        'Quali PMI stanno assumendo personale operativo, autisti, tecnici, operai o magazzinieri?',
        'Quali aziende hanno nuova sede, mezzi, cantieri, appalti o espansione che aumenta esposizione al rischio?',
        'Quali segnali pubblici indicano bisogno di polizze aziendali, responsabilita, fleet, cyber, welfare o infortuni?',
      ],
      reasoning: 'Seller-to-buyer reasoning: broker assicurativo -> rischio/asset/personale/compliance -> segnali hiring, appalti, espansione e nuove attivita.',
    }
  }
  if (kind === 'workplace_safety') {
    return {
      sector: 'PMI con segnali operativi, appalti o espansione produttiva coerenti con la richiesta',
      location,
      summary: 'Clienti caldi per consulenza sicurezza sul lavoro: imprese con attivita operative verificabili nella query.',
      research_questions: [
        'Quali PMI mostrano il segnale commerciale esplicitamente richiesto nella query?',
        'Quali evidenze pubbliche rendono attuale il bisogno HSE per il buyer?',
      ],
      reasoning: 'Seller-to-buyer reasoning: consulente sicurezza sul lavoro -> rischio operativo verificabile solo sui segnali esplicitamente richiesti.',
    }
  }
  if (kind === 'web_agency') {
    return {
      sector: 'PMI locali con sito migliorabile, tracking assente o domanda digitale attiva',
      location,
      signals: ['site_stale', 'no_pixel', 'no_gtm', 'investing_marketing', 'new_company'],
      summary: 'Clienti caldi per agenzia web: PMI con sito vecchio, tracking assente, nuova apertura o budget digitale da convertire meglio.',
      research_questions: [
        'Quali PMI hanno sito vecchio/lento, assenza di tracking, CTA deboli o problemi SEO verificabili?',
        'Quali aziende stanno gia investendo in ads/marketing ma hanno sito o funnel migliorabile?',
        'Quali nuove aperture o attivita locali hanno bisogno immediato di presenza digitale migliore?',
      ],
      reasoning: 'Seller-to-buyer reasoning: agenzia web/marketing -> revenue leak digitale -> audit tecnico, tracking assente, sito obsoleto, nuova apertura o ads attive.',
    }
  }
  if (kind === 'software_development') {
    return {
      sector: 'PMI con bisogno tecnologico, assunzioni tech o trasformazione digitale',
      location,
      signals: ['hiring', 'tech_migration', 'new_product', 'expansion'],
      summary: 'Clienti caldi per sviluppo software: aziende con hiring tech, digitalizzazione, nuovo prodotto o sistemi da modernizzare.',
      research_questions: [
        'Quali aziende stanno assumendo sviluppatori, IT manager, data o ruoli digitali?',
        'Quali PMI annunciano migrazioni, digital transformation, nuovo prodotto o automazione processi?',
        'Quale fonte prova urgenza tecnologica e budget potenziale?',
      ],
      reasoning: 'Seller-to-buyer reasoning: sviluppo software -> gap tecnico/automazione -> hiring tech, migrazione, nuovo prodotto o espansione.',
    }
  }
  return {
    sector: 'PMI con segnali recenti di crescita, budget o pain operativo coerenti con il servizio venduto',
    location,
    signals: ['new_company', 'expansion', 'hiring', 'seeking_supplier'],
    summary: 'Clienti caldi con segnali pubblici recenti di bisogno, crescita o ricerca fornitori.',
    research_questions: [
      'Quali aziende mostrano un evento recente che crea bisogno del servizio venduto?',
      'Quale fonte prova crescita, budget, ricerca fornitore o pain operativo?',
      'Il lead e PMI/professionista e non un brand enterprise/famoso?',
    ],
    reasoning: 'Seller-to-buyer reasoning generico: offerta utente -> pain/budget osservabile -> segnali recenti prima del contatto.',
  }
}

function laneCoversRequiredSignals(
  expectedEvidence: string[],
  requiredSignals: string[],
): boolean {
  const required = new Set(requiredSignals.map((signal) => canonicalSignalId(signal) || signal))
  return expectedEvidence.some((item) => required.has(canonicalSignalId(item) || item))
}

function sourcePlanForCommercialHypothesis(
  raw: unknown,
  query: string,
  signals: string[],
  hypothesis?: UqeCommercialHypothesis,
): UqeSourcePlanItem[] {
  const defaults = sellerPlaybookDefaults(query, hypothesis)
  const kind = classifySellerPlaybook(query, hypothesis)
  if (!defaults || !kind) return normalizeSourcePlan(raw, query, signals)
  // Seller-intent lanes are closed and deterministic. An LLM may improve the
  // wording, but cannot spend the SERP budget on registries/PDFs unrelated to
  // the observable commercial pain.
  if (kind === 'accounting_tax') {
    return [
      {
        lane: 'public_registry',
        source_types: ['Registro Imprese', 'Camere di commercio', 'comunicati nuove aperture'],
        query_templates: [
          '("nuova apertura" OR "nuova attivita" OR "costituita" OR "nasce") ("Srl" OR "startup" OR "impresa") {location}',
          '("apre" OR "inaugura" OR "nuova sede") ("negozio" OR "studio" OR "azienda" OR "ecommerce") {location}',
        ],
        expected_evidence: ['azienda', 'data apertura/costituzione', 'attivita', 'fonte'],
        priority: 100,
        llm_required: false,
      },
      {
        lane: 'job_market',
        source_types: ['careers', 'Indeed', 'InfoJobs', 'LinkedIn Jobs'],
        query_templates: [
          '("amministrazione" OR "contabile" OR "payroll" OR "back office") ("lavora con noi" OR "posizioni aperte") ("Srl" OR "PMI") {location}',
          '("impiegato amministrativo" OR "addetto contabilita" OR "payroll specialist") ("Srl" OR "azienda") {location}',
        ],
        expected_evidence: ['azienda', 'ruolo amministrativo/fiscale', 'data annuncio', 'URL fonte'],
        priority: 92,
        llm_required: false,
      },
      {
        lane: 'real_estate',
        source_types: ['news locali', 'siti ufficiali', 'comunicati apertura'],
        query_templates: [
          '("nuova sede" OR "ampliamento" OR "trasferimento sede") ("Srl" OR "PMI") {location}',
        ],
        expected_evidence: ['azienda', 'evento di crescita', 'data', 'URL fonte'],
        priority: 82,
        llm_required: true,
      },
      {
        lane: 'web_evidence',
        source_types: ['open web', 'stampa locale', 'sito ufficiale'],
        query_templates: ['{query}'],
        expected_evidence: ['azienda', 'trigger fiscale/amministrativo', 'data', 'URL fonte'],
        priority: 62,
        llm_required: true,
      },
    ]
  }
  if (kind === 'insurance_broker') {
    return [
      {
        lane: 'job_market',
        source_types: ['careers', 'Indeed', 'InfoJobs', 'LinkedIn Jobs'],
        query_templates: [
          '("autisti" OR "operai" OR "tecnici" OR "magazzinieri") ("lavora con noi" OR "assume" OR "posizioni aperte") ("Srl" OR "PMI") {location}',
          '("responsabile sicurezza" OR "HSE" OR "fleet manager" OR "logistica") ("Srl" OR "azienda") {location}',
        ],
        expected_evidence: ['azienda', 'ruolo che aumenta rischio/personale', 'data', 'URL fonte'],
        priority: 100,
        llm_required: false,
      },
      {
        lane: 'public_procurement',
        source_types: ['ANAC', 'albi pretori', 'gare aggiudicate'],
        query_templates: [
          '("aggiudicazione appalto" OR "appalto aggiudicato") ("Srl" OR "impresa") {location}',
          '("gara aggiudicata" OR "contratto affidato") ("edile" OR "logistica" OR "servizi") {location}',
        ],
        expected_evidence: ['azienda', 'appalto/contratto', 'data', 'ente/fonte'],
        priority: 94,
        llm_required: false,
      },
      {
        lane: 'real_estate',
        source_types: ['comunicati aziendali', 'news locali', 'siti ufficiali'],
        query_templates: [
          '("nuova sede" OR "ampliamento" OR "nuovi mezzi" OR "flotta") ("Srl" OR "PMI") {location}',
        ],
        expected_evidence: ['azienda', 'nuovo asset/sede/flotta', 'data', 'URL fonte'],
        priority: 86,
        llm_required: true,
      },
      {
        lane: 'compliance',
        source_types: ['normative', 'certificazioni', 'sicurezza lavoro'],
        query_templates: [
          '("certificazione" OR "sicurezza sul lavoro" OR "adeguamento") ("Srl" OR "PMI") {location}',
        ],
        expected_evidence: ['azienda', 'obbligo/rischio/compliance', 'data', 'URL fonte'],
        priority: 76,
        llm_required: true,
      },
    ]
  }
  if (kind === 'web_agency') {
    return [
      {
        lane: 'technology',
        source_types: ['audit sito ufficiale', 'HTML pubblico', 'performance/SEO'],
        query_templates: [
          'site:.it ("copyright 2019" OR "copyright 2020" OR "copyright 2021") ("Srl" OR "azienda" OR "negozio") {location}',
          'site:.it ("sito in costruzione" OR "coming soon" OR "under construction") ("Srl" OR "azienda") {location}',
        ],
        expected_evidence: ['dominio ufficiale', 'sito obsoleto/problema tecnico', 'indicatore verificabile'],
        priority: 100,
        llm_required: false,
      },
      {
        lane: 'ads',
        source_types: ['Meta Ad Library', 'Google Ads Transparency Center', 'landing page'],
        query_templates: [
          '("Meta Ads" OR "Google Ads" OR "campagne attive" OR "landing page") ("Srl" OR "PMI" OR "azienda") {location}',
          '("richiedi preventivo" OR "prenota" OR "contattaci") ("Meta Pixel" OR "Google Tag Manager" OR "Google Ads") ("Srl" OR "azienda") {location}',
        ],
        expected_evidence: ['campagna/landing', 'dominio ufficiale', 'problema funnel/tracking', 'data se disponibile'],
        priority: 90,
        llm_required: true,
      },
      {
        lane: 'public_registry',
        source_types: ['nuove aperture', 'stampa locale', 'siti ufficiali'],
        query_templates: [
          '("nuova apertura" OR "inaugura" OR "apre") ("ristorante" OR "hotel" OR "negozio" OR "studio") {location}',
        ],
        expected_evidence: ['azienda', 'nuova apertura', 'data', 'URL fonte'],
        priority: 78,
        llm_required: false,
      },
      {
        lane: 'web_evidence',
        source_types: ['open web', 'sito ufficiale'],
        query_templates: ['{query}'],
        expected_evidence: ['azienda', 'problema digitale o budget marketing', 'URL fonte'],
        priority: 60,
        llm_required: true,
      },
    ]
  }
  if (kind === 'workplace_safety') {
    const lanes = [
      {
        lane: 'public_procurement',
        source_types: ['public_procurement_portal'],
        query_templates: [
          '("aggiudicazione appalto" OR "appalto aggiudicato" OR "contratto affidato") ("Srl" OR "impresa") {location}',
          '(site:anac.gov.it OR site:ted.europa.eu) ("aggiudicazione" OR "aggiudicatario" OR "stazione appaltante") {location}',
        ],
        expected_evidence: ['contract_awarded'],
        priority: 100,
        llm_required: false,
      },
      {
        lane: 'job_market',
        source_types: ['company_careers', 'job_board'],
        query_templates: [
          'site:.it ("lavora con noi" OR careers OR "posizioni aperte") (operai OR autisti OR magazzinieri OR installatori OR manutentori OR tecnici) ("Srl" OR "PMI") {location}',
          '(site:indeed.it OR site:infojobs.it OR site:linkedin.com/jobs) (operai OR autisti OR magazzinieri OR installatori OR manutentori OR tecnici) ("Srl" OR "PMI") {location}',
        ],
        expected_evidence: ['hiring_operational'],
        priority: 95,
        llm_required: false,
      },
      {
        lane: 'news',
        source_types: ['recognized_local_news', 'industry_publication', 'official_company_website'],
        query_templates: [
          '("ampliamento produttivo" OR "nuovo stabilimento" OR "nuova linea produttiva" OR "ampliamento impianto") ("Srl" OR "PMI") {location}',
          'site:.it ("comunicato stampa" OR newsroom) ("ampliamento" OR "nuovo stabilimento" OR "nuova linea produttiva") {location}',
        ],
        expected_evidence: ['production_expansion'],
        priority: 90,
        llm_required: true,
      },
      {
        lane: 'regulatory',
        source_types: ['municipal_register'],
        query_templates: [
          '("SUAP" OR "autorizzazione unica" OR "albo pretorio" OR "ampliamento stabilimento" OR "ampliamento impianto") (impresa OR "Srl") {location}',
        ],
        expected_evidence: ['production_expansion'],
        priority: 82,
        llm_required: false,
      },
    ] as UqeSourcePlanItem[]
    return lanes.filter((lane) => laneCoversRequiredSignals(lane.expected_evidence, signals))
  }
  if (kind === 'software_development') {
    return [
      {
        lane: 'job_market',
        source_types: ['careers', 'Indeed', 'InfoJobs', 'LinkedIn Jobs'],
        query_templates: [
          '("sviluppatore" OR developer OR "IT manager" OR "data engineer") ("lavora con noi" OR careers OR "posizioni aperte") ("Srl" OR "PMI") {location}',
          '("digital transformation" OR "migrazione cloud" OR automazione) ("Srl" OR "PMI") {location}',
        ],
        expected_evidence: ['azienda', 'ruolo/progetto tech', 'data', 'URL fonte'],
        priority: 100,
        llm_required: false,
      },
      {
        lane: 'technology',
        source_types: ['newsroom', 'case study', 'sito ufficiale'],
        query_templates: [
          '("nuova piattaforma" OR "nuovo software" OR "digitalizzazione" OR "automazione processi") ("Srl" OR "PMI") {location}',
        ],
        expected_evidence: ['azienda', 'progetto digitale', 'data', 'URL fonte'],
        priority: 88,
        llm_required: true,
      },
    ]
  }
  if (kind === 'generic_consulting') {
    return [
      {
        lane: 'public_registry',
        source_types: ['nuove aperture', 'stampa locale', 'siti ufficiali'],
        query_templates: [
          '("nuova apertura" OR "nuova sede" OR "costituita" OR "nasce") ("Srl" OR "PMI" OR "azienda") {location}',
        ],
        expected_evidence: ['azienda', 'evento recente', 'data', 'URL fonte'],
        priority: 92,
        llm_required: false,
      },
      {
        lane: 'job_market',
        source_types: ['careers', 'Indeed', 'InfoJobs'],
        query_templates: [
          '("lavora con noi" OR "posizioni aperte" OR "assume") ("Srl" OR "PMI") {location}',
        ],
        expected_evidence: ['azienda', 'crescita/hiring', 'data', 'URL fonte'],
        priority: 86,
        llm_required: false,
      },
      {
        lane: 'web_evidence',
        source_types: ['open web', 'news locali'],
        query_templates: ['{query}'],
        expected_evidence: ['azienda', 'pain o budget coerente', 'data', 'URL fonte'],
        priority: 65,
        llm_required: true,
      },
    ]
  }
  return [
    {
      lane: 'job_market',
      source_types: ['careers ufficiali', 'Indeed', 'InfoJobs', 'LinkedIn Jobs'],
      query_templates: [
        '("SDR" OR "BDR" OR "Inside Sales") (outbound OR prospecting) Italia',
        '("Business Developer" OR "Sales Account") ("sviluppo nuovi clienti" OR pipeline OR "new business") Italia',
      ],
      expected_evidence: ['azienda', 'titolo ruolo', 'frase su outbound/new business', 'data annuncio', 'URL fonte'],
      priority: 100,
      llm_required: false,
    },
    {
      lane: 'company_web',
      source_types: ['sito ufficiale', 'careers', 'lavora con noi'],
      query_templates: [
        'site:.it (careers OR "lavora con noi") (SDR OR BDR OR "Business Developer")',
      ],
      expected_evidence: ['dominio ufficiale', 'ruolo sales', 'testo annuncio', 'data'],
      priority: 90,
      llm_required: false,
    },
    {
      lane: 'ads',
      source_types: ['Meta Ad Library', 'Google Ads Transparency Center', 'landing page ufficiali'],
      query_templates: [
        'PMI B2B Italia ("Meta Ad Library" OR "inserzioni attive" OR "campagne Meta") ("lead generation" OR demo OR "richiedi informazioni")',
        'PMI B2B Italia ("Google Ads" OR "landing page" OR "campagna") ("contattaci" OR demo OR preventivo)',
      ],
      expected_evidence: ['campagna/landing attiva', 'CTA commerciale', 'dominio ufficiale', 'data quando disponibile'],
      priority: 88,
      llm_required: true,
    },
    {
      lane: 'partnerships',
      source_types: ['comunicati partnership', 'newsroom', 'canale vendita'],
      query_templates: [
        'PMI Italia ("nuova partnership" OR "accordo commerciale" OR "canale vendita" OR "rete vendita")',
        'PMI B2B Italia ("partner commerciali" OR reseller OR "espansione commerciale")',
      ],
      expected_evidence: ['azienda', 'accordo/partner', 'obiettivo commerciale', 'data', 'URL fonte'],
      priority: 82,
      llm_required: true,
    },
    {
      lane: 'events',
      source_types: ['fiere', 'eventi B2B', 'webinar', 'sponsor'],
      query_templates: [
        'PMI B2B Italia (fiera OR expo OR webinar OR sponsor OR stand) ("nuovi clienti" OR "nuovi mercati" OR sales)',
        'PMI Italia ("partecipa a" OR "sarà presente a") (fiera OR evento) ("commerciale" OR "business development")',
      ],
      expected_evidence: ['azienda', 'evento', 'tema commerciale', 'data', 'URL fonte'],
      priority: 76,
      llm_required: true,
    },
    {
      lane: 'news',
      source_types: ['newsroom aziendale', 'comunicati stampa', 'stampa business'],
      query_templates: [
        'PMI Italia ("potenziamento commerciale" OR "nuovi mercati" OR "rete vendita")',
      ],
      expected_evidence: ['azienda', 'investimento sales', 'data', 'URL fonte'],
      priority: 70,
      llm_required: true,
    },
    {
      lane: 'web_evidence',
      source_types: ['motori di ricerca', 'annunci indicizzati'],
      query_templates: [query],
      expected_evidence: ['azienda', 'segnale commerciale esplicito', 'data', 'URL fonte'],
      priority: 60,
      llm_required: true,
    },
  ]
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
}

const DEFAULT_RANKING_POLICY: UqeRankingPolicy = {
  signal_match_mode: 'any',
  max_signal_age_days: 180,
  require_concrete_evidence: true,
  weights: {
    intent_fit: 0.25,
    signal_strength: 0.3,
    recency: 0.2,
    evidence_quality: 0.15,
    contactability: 0.1,
  },
}

function normalizeRankingPolicy(raw: unknown): UqeRankingPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_RANKING_POLICY
  const value = raw as Record<string, unknown>
  const rawWeights = value.weights && typeof value.weights === 'object'
    ? (value.weights as Record<string, unknown>)
    : {}
  const fallback = DEFAULT_RANKING_POLICY.weights
  const weights = {
    intent_fit: Math.max(0, Number(rawWeights.intent_fit) || fallback.intent_fit),
    signal_strength: Math.max(0, Number(rawWeights.signal_strength) || fallback.signal_strength),
    recency: Math.max(0, Number(rawWeights.recency) || fallback.recency),
    evidence_quality: Math.max(0, Number(rawWeights.evidence_quality) || fallback.evidence_quality),
    contactability: Math.max(0, Number(rawWeights.contactability) || fallback.contactability),
  }
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1
  return {
    signal_match_mode: value.signal_match_mode === 'all' ? 'all' : 'any',
    max_signal_age_days: Math.max(1, Math.min(1825, Math.round(Number(value.max_signal_age_days) || 180))),
    require_concrete_evidence: value.require_concrete_evidence !== false,
    weights: {
      intent_fit: weights.intent_fit / total,
      signal_strength: weights.signal_strength / total,
      recency: weights.recency / total,
      evidence_quality: weights.evidence_quality / total,
      contactability: weights.contactability / total,
    },
  }
}

function isLeadGenerationSellerQuery(query: string): boolean {
  const q = query.toLowerCase()
  const seller = /\b(a\s+cui\s+vendere|vendere\s+(?:il|la|i|le|un|una|mio|mia)|clienti\s+per|lead\s+cald|prospect)\b/i.test(q)
  const offer = /\b(lead\s*generation|sales\s*intelligence|prospect(?:ing)?|outreach|generazione\s+lead)\b/i.test(q)
  return seller && offer
}

function inferCommercialHypothesis(query: string): UqeCommercialHypothesis | undefined {
  if (isLeadGenerationSellerQuery(query)) {
    return {
      offer: 'Software di lead generation e Sales Intelligence',
      target_profile: [
        'PMI italiane B2B con processo commerciale attivo',
        'aziende che stanno costruendo o ampliando il team new business',
      ],
      buyer_pains: [
        'prospecting e ricerca account manuali',
        'pipeline insufficiente o costosa da alimentare',
        'SDR e commerciali che spendono tempo a cercare dati e contatti',
      ],
      buying_signals: [
        'assunzione recente di SDR, BDR, Inside Sales o Business Developer',
        'annuncio che cita outbound, prospecting, lead generation o sviluppo nuovi clienti',
        'potenziamento rete commerciale, ingresso in nuovi mercati o nuova pipeline',
      ],
      hiring_roles: [
        'Sales Development Representative',
        'Business Development Representative',
        'Inside Sales',
        'Business Developer',
        'Sales Account New Business',
        'Lead Generation Specialist',
      ],
      decision_maker_roles: ['CEO', 'Founder', 'Head of Sales', 'Sales Director', 'Revenue Operations'],
      disqualifiers: [
        'annuncio senza azienda identificabile',
        'ruolo puramente retail o assistenza clienti senza new business',
        'azienda non italiana o non coerente con PMI se il requisito e esplicito',
        'azienda enterprise/famosa quando l utente chiede PMI o target locale',
        'segnale senza URL o prova testuale',
      ],
    }
  }
  if (!isSellerAbstractQuery(query)) return undefined
  if (/\b(commercialist\w*|ragionier\w*|contabil\w*|fiscal\w*|paghe|payroll|bilancio|consulenza\s+fiscale)\b/i.test(query)) {
    return {
      offer: 'Servizi di commercialista, contabilita, fiscalita e gestione amministrativa',
      target_profile: [
        'nuove societa, nuove aperture e PMI appena entrate in fase operativa',
        'aziende in crescita che assumono amministrazione, contabile, back office o payroll',
        'PMI con nuova sede, ecommerce, espansione o complessita amministrativa crescente',
      ],
      buyer_pains: [
        'contabilita e adempimenti fiscali da strutturare dopo apertura o crescita',
        'paghe, contratti, fatture e scadenze fiscali che diventano difficili da gestire internamente',
        'rischio di errori amministrativi quando l azienda cresce o assume',
      ],
      buying_signals: [
        'nuova apertura, nuova societa o costituzione recente',
        'assunzione di ruoli amministrativi, contabili, back office o payroll',
        'nuova sede, espansione, ecommerce o aumento organico',
      ],
      hiring_roles: [
        'Impiegato amministrativo',
        'Addetto contabilita',
        'Back office amministrativo',
        'Payroll specialist',
      ],
      decision_maker_roles: ['Titolare', 'Founder', 'Amministratore', 'CFO', 'Responsabile Amministrativo'],
      disqualifiers: [
        'studi di commercialisti concorrenti se l utente non li ha richiesti',
        'portali, directory o articoli senza azienda identificabile',
        'azienda enterprise/famosa se l utente cerca PMI o clienti locali',
        'segnale senza fonte o evento concreto recente',
      ],
    }
  }
  if (/\b(broker\s+assicur|assicurazion|polizze?|rischi?\s+aziendal|welfare|infortuni|responsabilit\w*)\b/i.test(query)) {
    return {
      offer: 'Servizi di brokeraggio assicurativo e polizze aziendali',
      target_profile: [
        'PMI con personale, mezzi, magazzini, cantieri o responsabilita operative',
        'aziende che stanno assumendo ruoli operativi o tecnici',
        'imprese che vincono appalti, aprono sedi, aumentano flotta o asset assicurabili',
      ],
      buyer_pains: [
        'aumento del rischio operativo, responsabilita civile, infortuni, fleet o cyber',
        'nuovi contratti, appalti o sedi che richiedono coperture aggiornate',
        'crescita del personale che rende piu urgente protezione e welfare',
      ],
      buying_signals: [
        'assunzione di autisti, tecnici, operai, magazzinieri o ruoli HSE',
        'appalto o contratto pubblico appena aggiudicato',
        'nuova sede, flotta, cantiere, magazzino o espansione operativa',
      ],
      hiring_roles: ['Autista', 'Operaio', 'Tecnico', 'Magazziniere', 'HSE', 'Responsabile sicurezza'],
      decision_maker_roles: ['Titolare', 'Amministratore', 'CFO', 'HR Manager', 'Operations Manager'],
      disqualifiers: [
        'compagnie assicurative o broker concorrenti',
        'portali generici senza azienda target',
        'azienda enterprise/famosa se non richiesta',
        'segnale non collegato a rischio assicurabile o crescita operativa',
      ],
    }
  }
  if (/\b(web\s*agency|agenzia\s+web|rifare\s+il\s+sito|sito\s+web|ecommerce|shopify|seo\b|google\s+ads|meta\s+ads|marketing\s+digitale|social\s+media|performance\s+marketing)\b/i.test(query)) {
    return {
      offer: 'Servizi di agenzia web, sito, ecommerce, SEO, advertising o funnel digitale',
      target_profile: [
        'PMI locali con sito obsoleto, lento, senza tracking o con funnel debole',
        'aziende che stanno gia investendo in ads ma disperdono conversioni per sito/landing non ottimali',
        'nuove aperture e attivita locali che devono costruire presenza digitale e acquisizione clienti',
      ],
      buyer_pains: [
        'budget marketing sprecato per sito, tracking o CTA deboli',
        'mancanza di Meta Pixel, GTM, analytics o infrastruttura conversioni',
        'sito vecchio o non competitivo che limita richieste e prenotazioni',
      ],
      buying_signals: [
        'sito obsoleto, copyright vecchio, assenza tracking o problemi SEO',
        'campagne Meta/Google o landing attive con conversion tracking migliorabile',
        'nuova apertura, nuovo ecommerce o attività che deve acquisire clienti online',
      ],
      hiring_roles: ['Marketing Specialist', 'Ecommerce Manager', 'Digital Marketing Specialist'],
      decision_maker_roles: ['Titolare', 'Founder', 'Marketing Manager', 'Ecommerce Manager', 'Direttore Commerciale'],
      disqualifiers: [
        'agenzie web, agenzie marketing o consulenti concorrenti come lead',
        'brand enterprise/famosi salvo richiesta esplicita',
        'directory o articoli che parlano di marketing ma non identificano un cliente',
        'azienda senza sito ufficiale verificabile per audit',
      ],
    }
  }
  if (/\b(programmatore|developer|sviluppat\w*|software\s+engineer|full[\s-]?stack|app\b|saas|software\s+su\s+misura)\b/i.test(query)) {
    return {
      offer: 'Sviluppo software, automazioni, app, integrazioni o consulenza tecnica',
      target_profile: [
        'PMI che assumono ruoli tech o digitali',
        'aziende in trasformazione digitale, migrazione cloud o automazione processi',
        'PMI che lanciano nuovi prodotti, ecommerce o piattaforme digitali',
      ],
      buyer_pains: [
        'debito tecnico, processi manuali o sistemi non integrati',
        'difficolta a trovare talenti tech o consegnare progetti digitali',
        'necessita di automazione, app o software su misura durante crescita/nuovo prodotto',
      ],
      buying_signals: [
        'assunzione di developer, IT manager, data o digital specialist',
        'annuncio di digital transformation, migrazione cloud, automazione o nuovo software',
        'lancio nuovo prodotto, ecommerce o servizio digitale',
      ],
      hiring_roles: ['Sviluppatore', 'Developer', 'IT Manager', 'Data Engineer', 'Digital Specialist'],
      decision_maker_roles: ['CEO', 'Founder', 'CTO', 'IT Manager', 'Operations Manager'],
      disqualifiers: [
        'software house concorrenti se non sono target esplicito',
        'annunci generici senza azienda identificabile',
        'azienda enterprise/famosa se l utente cerca PMI',
        'fonte senza evidenza tecnica concreta',
      ],
    }
  }
  return undefined
}

function normalizeCommercialHypothesis(raw: unknown, query: string): UqeCommercialHypothesis | undefined {
  const inferred = inferCommercialHypothesis(query)
  if (inferred) return inferred
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const offer = String(value.offer || '').trim()
  if (!offer) return undefined
  return {
    offer,
    target_profile: asStringArray(value.target_profile),
    buyer_pains: asStringArray(value.buyer_pains),
    buying_signals: asStringArray(value.buying_signals),
    hiring_roles: asStringArray(value.hiring_roles),
    decision_maker_roles: asStringArray(value.decision_maker_roles),
    disqualifiers: asStringArray(value.disqualifiers),
  }
}

function normalizeSignals(signals: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of signals) {
    const key = raw.toLowerCase().trim().replace(/\s+/g, '_')
    const mapped = UQE_SIGNAL_ALIASES[key] || UQE_SIGNAL_ALIASES[raw.toLowerCase().trim()] || key
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped)
      out.push(mapped)
    }
  }
  return out
}

function normalizeStrategy(v: unknown): UqeSearchStrategy {
  const s = String(v || '').toLowerCase()
  if (s === 'graph' || s === 'maps' || s === 'hybrid' || s === 'fallback' || s === 'organic_web_search') {
    return s
  }
  return 'hybrid'
}

function technicalFiltersFromHeuristic(
  tf: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!tf || typeof tf !== 'object') return {}
  const out: Record<string, unknown> = { ...tf }
  if (tf.has_meta_pixel === false) out.has_meta_pixel = false
  if (tf.has_gtm === false) out.has_gtm = false
  if (tf.has_google_analytics === false) out.has_google_analytics = false
  if (Array.isArray(tf.technologies) && tf.technologies.length) {
    out.technologies = tf.technologies
  }
  return out
}

function inferEconomicIntentSignals(query: string): string[] {
  const q = query.toLowerCase()
  const out: string[] = []
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s)
  }

  if (isLeadGenerationSellerQuery(q)) {
    add('hiring')
    add('expansion')
    return out
  }

  if (/\b(gara|gare|appalt\w*|aggiudic\w*|contratt\w+\s+affidat\w*)\b/i.test(q)) {
    add('tender_won')
  }

  const sellerDefaults = sellerPlaybookDefaults(query)
  if (sellerDefaults?.signals?.length) {
    for (const signal of sellerDefaults.signals) add(signal)
    return out
  }

  if (/\b(commercialist\w*|ragionier\w*|contabil\w*|consulent\w*\s+fisc|cfd\b|fiscalist\w*)\b/i.test(q)) {
    add('new_company')
    add('funding_received')
  }
  if (/\b(programmator|sviluppat|developer|python|software|full[\s-]?stack)\b/i.test(q)) {
    add('hiring')
    add('tech_migration')
  }
  const buyerMarketingSpend = /\b(invest\w*(?:\s+\w+){0,3}\s+in\s+marketing|budget\s+marketing|spendono\s+in\s+pubblicit\w*)\b/i.test(q)
  if (buyerMarketingSpend) {
    add('investing_marketing')
  }
  if (
    !buyerMarketingSpend &&
    /\b(marketing|seo\b|google ads|meta ads|social media|agenzia)\b/i.test(q)
  ) {
    add('hiring')
    add('expansion')
  }
  if (/\b(potenziali clienti|vendere|clienti per|mi servono clienti|cerco clienti|servizi da)\b/i.test(q)) {
    add('new_company')
    add('funding_received')
    add('expansion')
  }
  if (/\b(sono\s+un|sono\s+una|freelanc|libero\s+profession)\b/i.test(q) && out.length === 0) {
    add('new_company')
    add('expansion')
  }
  return out
}

/** Intento venditore astratto → solo agentic organic. */
export function isSellerAbstractQuery(query: string): boolean {
  return /\b(sono\s+(?:un|una)\b|sn\s+(?:un|una)\b|i\s+sell|we\s+sell|find\s+(?:small\s+)?(?:italian\s+)?business\s+buyers|clients?\s+for|potenziali\s+clienti|cerco\s+clienti|trov\w+\s+lead|(?:trov\w*|cerc\w*)\s+pmi\b[^.]{0,120}\bbisogno|lead\s+caldi|a\s+cui\s+vendere|vend(?:o|iamo)|offr(?:o|iamo)|vendere\s+(?:il|la|un|una|i|le|mio|mia)|servizi\s+da|clienti\s+per|mi\s+servono\s+clienti)\b/i.test(
    query.trim(),
  )
}

/** Solo fallback offline quando LLM non risponde — non usato per routing produzione. */
function _heuristicLooksAbstract(query: string): boolean {
  return isSellerAbstractQuery(query)
}

const NON_GEO_AFTER_PREP =
  'marketing|software|digitale|crescita|espansione|vendite|cloud|crm|seo|ads|pubblicit\\w*'
const MAPS_CATEGORY_CITY_RE = new RegExp(
  `\\b(ristoranti|bar|hotel|pizzeri|officine|agenzie\\s+(?:immobiliari|viaggi|marketing|web)|studi\\s+(?:legali|dentistici|commercialisti)|lavanderie|parrucchieri|commercialisti|dentisti|idraulici|elettricisti|imprese\\s+(?:edili|pulizie)|edili|pulizie)\\b.*\\b(a|ad|in)\\s+(?!${NON_GEO_AFTER_PREP}\\b)[A-Za-zÀ-ÿ]{3,}`,
  'i',
)

const SIGNAL_LED_SEARCH_SIGNALS = new Set([
  'investing_marketing',
  'hiring',
  'hiring_operational',
  'hiring_technology',
  'hiring_sales',
  'hiring_marketing',
  'tender_won',
  'sector_investment',
  'funding_received',
  'expansion',
  'executive_change',
  'registry_change',
  'seeking_supplier',
  'new_product',
  'market_entry',
])

/** Query basata su segnale d'acquisto astratto → WebResearcher (Fase 5), non Maps. */
export function isSignalLedAbstractQuery(query: string, requiredSignals: string[]): boolean {
  const q = query.trim()
  if (!q || isSellerAbstractQuery(q)) return false
  if (!requiredSignals.some((s) => SIGNAL_LED_SEARCH_SIGNALS.has(s))) return false
  return true
}

function signalLedAgenticSector(plan: MiraxQueryPlan, query: string): string {
  if (isBuyerMarketingInvestmentQuery(query)) return 'Segnali acquisto'
  const sector = plan.sector?.trim() || ''
  if (
    sector &&
    !isSellerMarketingAgencySector(sector) &&
    !_heuristicVagueSector(sector) &&
    !/^aziende\s+in\s+crescita$/i.test(sector)
  ) {
    return sector
  }
  return 'Segnali acquisto'
}

/**
 * Corregge routing LLM: segnali d'acquisto astratti → organic_web_search (agentic).
 */
export function applyRoutingGuards(plan: MiraxQueryPlan, query: string): MiraxQueryPlan {
  const q = query.trim()
  if (!q) return plan

  const signalLed =
    isBuyerMarketingInvestmentQuery(q) ||
    isSignalLedAbstractQuery(q, plan.required_signals)

  if (signalLed) {
    const signals = new Set(plan.required_signals)
    if (isBuyerMarketingInvestmentQuery(q)) {
      signals.add('investing_marketing')
      signals.delete('funding_received')
      signals.delete('expansion')
    }
    return {
      ...plan,
      search_strategy: 'organic_web_search',
      sector: signalLedAgenticSector(plan, q),
      location: plan.location?.trim() || 'Italia',
      required_signals: normalizeSignals([...signals]),
      reasoning: `${plan.reasoning || ''} [routing_guard: agentic_signal_search]`.trim(),
    }
  }

  let strategy = plan.search_strategy
  const hasTech = plan.technical_filters && Object.keys(plan.technical_filters).length > 0
  const hasSector = Boolean(plan.sector?.trim() && plan.sector.trim().length >= 4)
  const hasLocation = isRealGeoLocation(plan.location || '')
  const hasSignals = plan.required_signals.length > 0

  if (strategy === 'organic_web_search' && !isSellerAbstractQuery(q)) {
    if (!signalLed) {
      strategy = hasSignals || hasSector ? 'hybrid' : 'maps'
    }
  }

  if (
    (MAPS_CATEGORY_CITY_RE.test(q) || (hasTech && (hasSector || hasLocation))) &&
    !isSellerAbstractQuery(q) &&
    !signalLed
  ) {
    strategy = 'maps'
  }

  if (strategy === 'graph' && (hasSector || hasSignals) && !/\b(grafo|forniscono a|catena|relazione)\b/i.test(q)) {
    strategy = 'hybrid'
  }

  if (strategy === plan.search_strategy) return plan
  return {
    ...plan,
    search_strategy: strategy,
    reasoning: `${plan.reasoning || ''} [routing_guard: ${plan.search_strategy}→${strategy}]`.trim(),
  }
}

const SOURCE_CLASSES_BY_LANE: Record<UqeSourceLane, string[]> = {
  public_registry: ['official_registry'],
  public_procurement: ['public_procurement_portal', 'municipal_register'],
  job_market: ['company_careers', 'job_board'],
  funding: ['official_company_website', 'recognized_local_news'],
  company_web: ['official_company_website'],
  news: ['recognized_local_news', 'industry_publication'],
  technology: ['technology_audit'],
  real_estate: ['municipal_register', 'recognized_local_news'],
  regulatory: ['municipal_register', 'official_registry'],
  ads: ['ad_transparency_library'],
  reviews: ['official_company_website'],
  events: ['official_company_website', 'recognized_local_news', 'industry_publication'],
  marketplace: ['official_company_website'],
  partnerships: ['official_company_website', 'recognized_local_news', 'industry_publication'],
  compliance: ['official_registry', 'municipal_register', 'public_procurement_portal'],
  web_evidence: ['search_snippet'],
}

/** Attach fail-closed runtime truth to every lane before execution. */
export function applySourceCapabilityGuards(plan: MiraxQueryPlan): MiraxQueryPlan {
  const sourcePlan = (plan.source_plan || []).map((lane) => {
    const laneSignals = lane.expected_evidence
      .map((signal) => canonicalSignalId(signal) || signal)
      .filter((signal) => plan.required_signals.includes(signal))
    const signalIds = laneSignals.length ? laneSignals : plan.required_signals
    const coverage = SOURCE_CAPABILITY_REGISTRY.resolve({
      intent: plan.search_strategy,
      signal_ids: signalIds,
      signal_match_mode: plan.ranking_policy?.signal_match_mode || 'all',
      geographies: plan.location ? [plan.location] : [],
      freshness_max_age_days: plan.evidence_policy?.max_age_days ?? null,
      requested_count: 1,
      budget_eur: 0,
    }, SOURCE_CLASSES_BY_LANE[lane.lane], true)
    return {
      ...lane,
      coverage_status: coverage.status,
      adapter_ids: coverage.adapter_ids,
      coverage_gaps: coverage.missing_signals,
      execution_mode: coverage.status === 'supported'
        ? 'adapter' as const
        : coverage.status === 'generic_fallback_partial'
          ? 'generic_fallback' as const
          : 'blocked' as const,
    }
  })
  const statuses = sourcePlan.map((lane) => lane.coverage_status)
  const status = statuses.length > 0 && statuses.every((value) => value === 'supported')
    ? 'supported' as const
    : statuses.some((value) => value === 'generic_fallback_partial')
      ? 'generic_fallback_partial' as const
      : 'unsupported' as const
  return {
    ...plan,
    source_plan: sourcePlan,
    source_coverage: {
      status,
      adapter_ids: [...new Set(sourcePlan.flatMap((lane) => lane.adapter_ids || []))],
      missing_signals: [...new Set(sourcePlan.flatMap((lane) => lane.coverage_gaps || []))],
    },
  }
}

function _heuristicVagueSector(sector: string): boolean {
  const s = sector.trim().toLowerCase()
  if (!s) return true
  if (/^(aziende?|pmi|servizi?|clienti?|generico|business|italia)$/i.test(s)) return true
  return s.length < 4
}

function isRealGeoLocation(location: string): boolean {
  const s = location.trim().toLowerCase()
  if (!s || s === 'italia') return false
  return !/^(marketing|software|digitale|crescita|espansione|vendite|cloud|crm|seo|ads)$/i.test(s)
}

function inferStrategyFromQuery(query: string, sector: string, location: string, signals: string[]): UqeSearchStrategy {
  if (isSellerAbstractQuery(query)) return 'organic_web_search'
  if (isBuyerMarketingInvestmentQuery(query) || isSignalLedAbstractQuery(query, signals)) {
    return 'organic_web_search'
  }
  const q = query.toLowerCase()
  const graphHint =
    /\b(forniscono|fornitore|partner|investito|investe|supply chain|catena|relazione|grafo|clienti di|fornisce a)\b/i.test(q)
  const mapsHint =
    Boolean(sector && location && isRealGeoLocation(location) && !_heuristicVagueSector(sector)) ||
    (isRealGeoLocation(location) && /\b(milano|roma|torino|napoli|bologna)\b/i.test(q))
  if (signals.length > 0 && !isRealGeoLocation(location)) return 'hybrid'
  if (graphHint && mapsHint) return 'hybrid'
  if (graphHint) return 'graph'
  if (mapsHint || (sector && !_heuristicVagueSector(sector) && isRealGeoLocation(location))) return 'maps'
  if (signals.length > 0) return 'hybrid'
  return 'maps'
}

function extractionFromQuery(query: string): string[] {
  const base: string[] = [...DEFAULT_EXTRACTION_SCHEMA]
  const q = query.toLowerCase()
  if (/\bfatturato\b|\brevenue\b|\bturnover\b/i.test(q) && !base.includes('fatturato')) base.push('fatturato')
  if (/\bpartita\s*iva\b|\bpiva\b|\bvat\b/i.test(q) && !base.includes('partita_iva')) base.push('partita_iva')
  if (/\binstagram\b/i.test(q) && !base.includes('instagram')) base.push('instagram')
  if (/\blinkedin\b/i.test(q) && !base.includes('linkedin')) base.push('linkedin')
  if (isSellerAbstractQuery(query) || /\b(segnal\w*\s+d.?acquisto|lead\s+cald)\b/i.test(q)) {
    for (const field of [
      'linkedin', 'instagram', 'facebook', 'decision_maker', 'evidence', 'evidence_date',
      'source_url', 'hiring_title', 'hotness_score', 'why_now', 'pitch_angle',
    ]) {
      if (!base.includes(field)) base.push(field)
    }
  }
  return base
}

function planHasExecutableTarget(plan: Pick<MiraxQueryPlan, 'sector' | 'location' | 'required_signals' | 'technical_filters'>): boolean {
  const hasTech = plan.technical_filters && Object.keys(plan.technical_filters).length > 0
  const hasSignals = plan.required_signals.length > 0
  const hasSector = Boolean(plan.sector.trim())
  const hasLocation = Boolean(plan.location.trim())
  return hasSector || hasLocation || hasSignals || hasTech
}

export function normalizeMiraxQueryPlan(
  raw: RawToolPlan,
  originalQuery: string,
  parseSource: UqeParseSource,
): MiraxQueryPlan {
  if (raw.is_unmappable) {
    return createFallbackPlan(
      originalQuery,
      raw.user_message?.trim() ||
        'Non sono riuscito a capire la richiesta. Prova a specificare settore, città o segnale (es. assunzioni, senza Meta Pixel).',
      parseSource,
    )
  }

  const inferredHypothesis = inferCommercialHypothesis(originalQuery)
  const inferredDefaults = sellerPlaybookDefaults(originalQuery, inferredHypothesis)
  let sector = String(raw.sector || '').trim()
  let location = String(raw.location || '').trim()
  let required_signals = normalizeSignals(asStringArray(raw.required_signals))
  if (inferredDefaults) {
    sector = inferredDefaults.sector
    location = inferredDefaults.location
    if (inferredDefaults.signals?.length) {
      required_signals = normalizeSignals(inferredDefaults.signals)
    }
  }
  const technical_filters =
    raw.technical_filters && typeof raw.technical_filters === 'object' && !Array.isArray(raw.technical_filters)
      ? (raw.technical_filters as Record<string, unknown>)
      : {}

  const extraction_schema = [
    ...new Set([...asStringArray(raw.extraction_schema), ...extractionFromQuery(originalQuery)]),
  ]
  const confidence = clampConfidence(raw.confidence)
  const commercial_hypothesis = normalizeCommercialHypothesis(raw.commercial_hypothesis, originalQuery)
  const model_ranking_policy = normalizeRankingPolicy(raw.ranking_policy)
  const ranking_policy = inferredHypothesis
    ? {
        ...DEFAULT_RANKING_POLICY,
        max_signal_age_days: Math.min(180, model_ranking_policy.max_signal_age_days),
      }
    : model_ranking_policy

  let search_strategy = normalizeStrategy(raw.search_strategy)
  if (search_strategy === 'fallback') search_strategy = 'hybrid'

  const plan: MiraxQueryPlan = {
    original_query: originalQuery,
    search_strategy,
    sector,
    location,
    required_signals,
    technical_filters,
    extraction_schema: extraction_schema.length ? extraction_schema : extractionFromQuery(originalQuery),
    confidence,
    intent_summary: inferredDefaults?.summary || String(raw.intent_summary || '').trim() || `Ricerca: ${originalQuery.slice(0, 120)}`,
    parse_source: parseSource,
    research_questions: asStringArray(raw.research_questions).length
      ? asStringArray(raw.research_questions)
      : inferredDefaults?.research_questions || [`Quali organizzazioni soddisfano: ${originalQuery}?`],
    source_plan: sourcePlanForCommercialHypothesis(
      raw.source_plan,
      originalQuery,
      required_signals,
      commercial_hypothesis,
    ),
    evidence_policy: {
      require_source_url: true,
      require_official_domain: true,
      min_signal_confidence: 0.7,
      max_age_days: ranking_policy.max_signal_age_days,
    },
    commercial_hypothesis,
    ranking_policy,
    user_message: raw.user_message?.trim() || null,
    reasoning: inferredDefaults?.reasoning || raw.reasoning?.trim() || null,
  }

  if (!planHasExecutableTarget(plan) || confidence < 0.15) {
    return createFallbackPlan(
      originalQuery,
      plan.user_message ||
        'Specifica almeno un settore, una città o un criterio (es. "ristoranti Milano senza Meta Pixel").',
      parseSource,
    )
  }

  return applySourceCapabilityGuards(applyRoutingGuards(plan, originalQuery))
}

export function buildHeuristicMiraxQueryPlan(userInput: string): MiraxQueryPlan {
  const query = userInput.trim()
  const spec = parseSignalIntentHeuristic(query)
  const commercial_hypothesis = inferCommercialHypothesis(query)
  const sellerDefaults = sellerPlaybookDefaults(query, commercial_hypothesis)
  let sector = String(spec.category || spec.sector_keywords?.[0] || '').trim()
  let location = String(spec.location || '').trim()
  const economicSignals = inferEconomicIntentSignals(query)
  let required_signals = normalizeSignals([
    ...(spec.required_signals || []),
    ...economicSignals,
  ])
  const technical_filters = technicalFiltersFromHeuristic(
    (spec.technical_filters || {}) as Record<string, unknown>,
  )

  if (sellerDefaults) {
    sector = sellerDefaults.sector
    location = sellerDefaults.location
    if (sellerDefaults.signals?.length) {
      required_signals = normalizeSignals(sellerDefaults.signals)
    }
  }

  if (!sector && (_heuristicLooksAbstract(query) || economicSignals.length > 0)) {
    sector = 'aziende in crescita'
  }

  if (
    required_signals.includes('investing_marketing') &&
    isBuyerMarketingInvestmentQuery(query) &&
    (isSellerMarketingAgencySector(sector) || !sector)
  ) {
    sector = 'Segnali acquisto'
  }

  const search_strategy = inferStrategyFromQuery(query, sector, location, required_signals)
  const ranking_policy = normalizeRankingPolicy(undefined)

  const plan: MiraxQueryPlan = {
    original_query: query,
    search_strategy,
    sector,
    location,
    required_signals,
    technical_filters,
    extraction_schema: extractionFromQuery(query),
    confidence: planHasExecutableTarget({ sector, location, required_signals, technical_filters }) ? 0.45 : 0.1,
    intent_summary: sellerDefaults
      ? sellerDefaults.summary
      : spec.intent_summary || `Ricerca euristica: ${query.slice(0, 100)}`,
    parse_source: 'heuristic',
    research_questions: sellerDefaults
      ? sellerDefaults.research_questions
      : [`Quali organizzazioni soddisfano: ${query}?`],
    source_plan: sourcePlanForCommercialHypothesis(
      undefined,
      query,
      required_signals,
      commercial_hypothesis,
    ),
    evidence_policy: {
      require_source_url: true,
      require_official_domain: true,
      min_signal_confidence: 0.7,
      max_age_days: ranking_policy.max_signal_age_days,
    },
    commercial_hypothesis,
    ranking_policy,
    reasoning: sellerDefaults
      ? sellerDefaults.reasoning
      : spec.reasoning || 'Parser euristico offline.',
  }

  if (!planHasExecutableTarget(plan) || plan.confidence < 0.15) {
    return createFallbackPlan(
      query,
      'Non ho capito abbastanza la richiesta. Indica settore, città o segnale commerciale.',
      'heuristic',
    )
  }

  return applySourceCapabilityGuards(applyRoutingGuards(plan, query))
}

async function callOpenAiQueryPlan(query: string): Promise<RawToolPlan | null> {
  return null
}

function sourceClassLane(sourceClass: string): UqeSourceLane {
  const value = sourceClass.toLowerCase()
  // A municipal register is a regulatory/permit source, not a procurement
  // portal. Treating it as procurement silently changed expansion signals into
  // tender queries and spent budget on semantically unrelated pages.
  if (/municipal/.test(value)) return 'regulatory'
  if (/procurement|tender|appalt/.test(value)) return 'public_procurement'
  if (/registry|register|camera_commercio/.test(value)) return 'public_registry'
  if (/career|job|hiring/.test(value)) return 'job_market'
  if (/ad_library|advert|google_ads|meta_ads/.test(value)) return 'ads'
  if (/technology|stack|builtwith/.test(value)) return 'technology'
  if (/regulat|compliance/.test(value)) return 'compliance'
  if (/news|press|publication/.test(value)) return 'news'
  if (/event|trade_fair|conference/.test(value)) return 'events'
  return 'web_evidence'
}

function canonicalLaneQueryTemplates(
  lane: UqeSourceLane,
  requiredSignals: string[],
  plan: CommercialSearchPlan,
): string[] {
  const signalSet = new Set(requiredSignals)
  if (lane === 'job_market') {
    const roleClause = signalSet.has('hiring_technology')
      ? '(developer OR sviluppatore OR "software engineer" OR "data engineer" OR cybersecurity)'
      : signalSet.has('hiring_sales')
        ? '(sales OR commerciale OR venditore OR "account manager" OR "business developer")'
        : signalSet.has('hiring_marketing')
          ? '(marketing OR growth OR SEO OR content OR advertising)'
          : signalSet.has('hiring_operational')
            ? '(operai OR autisti OR magazzinieri OR installatori OR manutentori OR tecnici)'
            : '("ruoli aperti" OR assunzioni OR "ricerca personale")'
    return [
      `site:.it ("lavora con noi" OR careers OR "posizioni aperte") ${roleClause} ("Srl" OR "PMI" OR azienda) {location} -site:indeed.it -site:infojobs.it -site:linkedin.com`,
      `(site:indeed.it OR site:infojobs.it OR site:linkedin.com/jobs) ${roleClause} ("Srl" OR "PMI" OR azienda) {location}`,
    ]
  }
  if (signalSet.has('production_expansion')) {
    if (lane === 'regulatory') {
      return [
        '("albo pretorio" OR SUAP OR "sportello unico attività produttive" OR site:gov.it) ("ampliamento stabilimento" OR "nuovo impianto" OR "aumento capacità produttiva" OR "autorizzazione unica") (impresa OR "Srl") {location}',
      ]
    }
    if (lane === 'news') {
      return [
        '("ampliamento produttivo" OR "nuovo stabilimento" OR "nuovo impianto" OR "aumento capacità produttiva") ("comunicato stampa" OR newsroom OR notizie) ("Srl" OR "PMI") {location}',
      ]
    }
    return [
      'site:.it ("ampliamento produttivo" OR "nuovo stabilimento" OR "nuovo impianto" OR "aumento capacità produttiva") ("Srl" OR "PMI") {location}',
    ]
  }
  if (signalSet.has('new_location')) {
    return [
      '("nuova sede" OR "apertura filiale" OR "nuovo stabilimento" OR trasferimento OR inaugura) ("Srl" OR "PMI") {location}',
    ]
  }
  if (signalSet.has('cybersecurity_exposure')) {
    return [
      'site:.it (ecommerce OR e-commerce OR webmail OR "area clienti" OR "servizi esposti") ("Srl" OR "PMI") {location}',
    ]
  }
  if (signalSet.has('regulatory_change')) {
    return [
      '("nuovi requisiti" OR "adeguamento normativo" OR "obbligo normativo" OR autorizzazione) ("Srl" OR "PMI") {location}',
    ]
  }
  if (signalSet.has('technology_migration') || signalSet.has('manual_processes')) {
    return [
      '("migrazione software" OR "nuovo ERP" OR "nuovo CRM" OR "digital transformation" OR "processi manuali") ("Srl" OR "PMI") {location}',
    ]
  }
  if (lane === 'public_procurement') {
    return ['("appalto aggiudicato" OR "gara aggiudicata" OR "contratto affidato") ("Srl" OR impresa) {location}']
  }
  if (lane === 'public_registry') {
    return ['("variazione societaria" OR "nuova sede" OR costituita OR "aumento di capitale") ("Srl" OR "PMI") {location}']
  }
  if (lane === 'technology') {
    return ['("migrazione software" OR "nuova piattaforma" OR "digital transformation" OR "processi manuali") ("Srl" OR "PMI") {location}']
  }
  if (lane === 'ads') {
    return ['("inserzioni attive" OR "Meta Ads" OR "Google Ads" OR "conversion tracking") ("Srl" OR "PMI") {location}']
  }
  if (lane === 'compliance') {
    return ['("adeguamento normativo" OR compliance OR certificazione OR autorizzazione) ("Srl" OR "PMI") {location}']
  }
  if (lane === 'news') {
    return ['("comunicato stampa" OR newsroom OR "stampa locale") ("Srl" OR "PMI") {location}']
  }
  return [`${plan.raw_query} ("Srl" OR "PMI") {location}`]
}

function primaryPreferredSourceForSignal(signal: string, preferredSources: string[]): string | null {
  const definition = getSignalDefinition(signal)
  if (!definition) return null
  return definition.preferredSourceClasses.find((source) => preferredSources.includes(source))
    || definition.likelySourceClasses.find((source) => preferredSources.includes(source))
    || null
}

export function canonicalPlanToLegacy(plan: CommercialSearchPlan): MiraxQueryPlan {
  const requiredSignals = normalizeSignals(plan.signal_policy.required_signals)
  const preferredCompatible = plan.source_policy.preferred_source_classes.filter((source) =>
    requiredSignals.some((signal) => sourceSupportsSignal(source, signal)),
  )
  const allowedCompatible = plan.source_policy.allowed_source_classes.filter((source) =>
    requiredSignals.some((signal) => sourceSupportsSignal(source, signal)),
  )
  const preferredSources = [...preferredCompatible]
  for (const signal of requiredSignals) {
    if (preferredSources.some((source) => sourceSupportsSignal(source, signal))) continue
    const compatibleFallback = allowedCompatible.find((source) => sourceSupportsSignal(source, signal))
    if (compatibleFallback) preferredSources.push(compatibleFallback)
  }
  const grouped = new Map<UqeSourceLane, string[]>()
  for (const sourceClass of preferredSources) {
    const lane = sourceClassLane(sourceClass)
    grouped.set(lane, [...new Set([...(grouped.get(lane) || []), sourceClass])])
  }
  const firstHypothesis = plan.commercial_hypotheses[0]
  const signalAges = Object.values(plan.signal_policy.maximum_age_days_by_signal)
  const maxSignalAgeDays = signalAges.length ? Math.min(3650, ...signalAges) : 365
  const sector = plan.target.industries.join(', ') || plan.target.entity_types.join(', ') || 'PMI'
  const location = plan.target.geographies.join(', ') || 'Italia'
  const legacy: MiraxQueryPlan = {
    original_query: plan.raw_query,
    search_strategy: inferStrategyFromQuery(plan.raw_query, sector, location, requiredSignals),
    sector,
    location,
    required_signals: requiredSignals,
    technical_filters: {},
    extraction_schema: extractionFromQuery(plan.raw_query),
    confidence: Math.max(0.15, 1 - plan.ambiguity.score),
    intent_summary: `${plan.seller.offer_description} → ${firstHypothesis.implied_need}`,
    parse_source: 'llm',
    canonical_plan: plan,
    research_questions: plan.commercial_hypotheses.map(
      (item) => `Quale evidenza osservabile dimostra ${item.triggering_events.join(' / ')} per ${item.buyer_problem}?`,
    ),
    source_plan: [...grouped.entries()].map(([lane, sourceTypes], index) => {
      const laneSignals = requiredSignals.filter((signal) => {
        const primary = primaryPreferredSourceForSignal(signal, preferredSources)
        return Boolean(primary && sourceTypes.includes(primary))
      })
      return {
        lane,
        source_types: sourceTypes,
        query_templates: canonicalLaneQueryTemplates(lane, laneSignals, plan),
        expected_evidence: laneSignals,
        priority: Math.max(1, 100 - index * 10),
        llm_required: true,
      }
    }),
    evidence_policy: {
      require_source_url: plan.evidence_policy.require_source_url,
      require_official_domain: plan.evidence_policy.require_official_domain,
      min_signal_confidence: plan.evidence_policy.minimum_evidence_confidence,
      max_age_days: maxSignalAgeDays,
    },
    commercial_hypothesis: {
      offer: plan.seller.offer_description,
      target_profile: [
        ...plan.target.industries,
        ...plan.target.company_sizes,
        ...plan.target.required_attributes,
      ],
      buyer_pains: plan.commercial_hypotheses.map((item) => item.buyer_problem),
      buying_signals: plan.commercial_hypotheses.flatMap((item) => item.signals),
      hiring_roles: [],
      decision_maker_roles: plan.seller.preferred_buyer_roles,
      disqualifiers: [
        ...plan.target.excluded_attributes,
        ...plan.target.excluded_entities,
        ...plan.signal_policy.negative_signals,
      ],
    },
    ranking_policy: {
      signal_match_mode: requiredSignals.length > 1 ? 'any' : 'all',
      max_signal_age_days: maxSignalAgeDays,
      require_concrete_evidence: true,
      weights: {
        intent_fit: plan.ranking_policy.weight_buyer_fit + plan.ranking_policy.weight_need_gap,
        signal_strength: plan.ranking_policy.weight_signal_strength,
        recency: plan.ranking_policy.weight_freshness,
        evidence_quality: plan.ranking_policy.weight_evidence_confidence,
        contactability: plan.ranking_policy.weight_contactability,
      },
    },
    user_message: null,
    reasoning: `Canonical commercial plan ${plan.schema_version}; prompt ${plan.planner_metadata.prompt_version}.`,
  }
  return applySourceCapabilityGuards(applyRoutingGuards(legacy, plan.raw_query))
}

/**
 * Piano unico da linguaggio naturale — Tool Calling LLM + fallback euristico.
 * Non ritorna mai un piano "vuoto silenzioso": fallback esplicito o errore.
 */
export async function buildMiraxQueryPlan(
  userInput: string,
  options: CommercialIntentCompilerOptions = {},
): Promise<MiraxQueryPlan> {
  const query = userInput.trim()
  if (!query) {
    throw new UqePlannerError('Query vuota.', 'UQE_EMPTY_QUERY')
  }

  if (query.length > 2000) {
    throw new UqePlannerError('Query troppo lunga (max 2000 caratteri).', 'UQE_QUERY_TOO_LONG')
  }

  const contradictions = detectQueryContradictions(query)
  if (contradictions.length > 0) {
    return createFallbackPlan(
      query,
      'La richiesta contiene vincoli incompatibili. Correggi territorio o dimensione aziendale prima di avviare la ricerca.',
      'fallback',
    )
  }

  const canonicalPlan = await compileCommercialSearchPlan(query, options)
  if (canonicalPlan) return canonicalPlanToLegacy(canonicalPlan)

  const heuristic = buildHeuristicMiraxQueryPlan(query)
  if (heuristic.search_strategy === 'fallback') {
    return heuristic
  }

  return heuristic
}
