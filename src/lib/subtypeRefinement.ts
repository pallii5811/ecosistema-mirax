import 'server-only'

/**
 * SUBTYPE REFINEMENT — filtro per sotto-tipo basato sul CONTENUTO REALE del sito.
 *
 * Problema risolto: una ricerca generica (es. "frigoristi") restituisce sia attività
 * industriali che domestiche, perché la categoria di Google non distingue il sotto-tipo.
 * La discriminante richiesta è oggettiva: ciò che è scritto sul sito dell'attività.
 *
 * Principi (non negoziabili):
 *  - Si attiva SOLO se la query contiene un qualificatore riconosciuto (es. "industriale").
 *    Senza qualificatore, `detectSubtypeIntent` ritorna null e il refinement è un no-op:
 *    nessuna regressione sulle ricerche esistenti.
 *  - Classifica leggendo il testo reale del sito, mai inventando.
 *  - Decisione esplicita e tracciabile: 'match' (conferma il sotto-tipo richiesto),
 *    'opposite' (conferma il sotto-tipo opposto), 'unknown' (nessuna prova).
 */

export type SubtypeIntent = {
  /** Dominio merceologico riconosciuto (es. 'refrigerazione'). */
  domain: string
  /** Qualificatore richiesto dall'utente (es. 'industriale'). */
  qualifier: string
  /** Etichetta leggibile per log/UI. */
  label: string
  /** Parole/frasi che CONFERMANO il sotto-tipo richiesto. */
  positives: string[]
  /** Parole/frasi del sotto-tipo OPPOSTO (segnale di esclusione). */
  negatives: string[]
}

export type SubtypeVerdict = 'match' | 'opposite' | 'unknown'

export type SubtypeClassification = {
  verdict: SubtypeVerdict
  matchedPositives: string[]
  matchedNegatives: string[]
}

// ── Normalizzazione testo (accenti, spazi, punteggiatura) ──────────────────────
function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Match per frase intera con confini di parola, robusto a varianti di spaziatura.
 * Per frasi multi-parola usa spazi flessibili; per parole singole richiede word boundary.
 */
function phraseMatches(haystackNorm: string, phraseRaw: string): boolean {
  const phrase = normalize(phraseRaw)
  if (!phrase) return false
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i')
  return re.test(haystackNorm)
}

// ── Cataloghi sotto-tipo (estendibili) ─────────────────────────────────────────
// Refrigerazione INDUSTRIALE/COMMERCIALE (quello che il cliente vuole vedere).
const REFRIGERATION_INDUSTRIAL: SubtypeIntent = {
  domain: 'refrigerazione',
  qualifier: 'industriale',
  label: 'frigorista industriale/commerciale',
  positives: [
    'industriale', 'industriali', 'refrigerazione industriale', 'refrigerazione commerciale',
    'frigoriferi industriali', 'frigorifero industriale', 'freddo industriale',
    'impianti frigoriferi', 'impianto frigorifero', 'impianti di refrigerazione', 'impianto di refrigerazione',
    'celle frigorifere', 'cella frigorifera', 'celle frigo', 'cella frigo',
    'gruppi frigoriferi', 'gruppo frigorifero', 'banchi frigo', 'banco frigo',
    'vetrine refrigerate', 'vetrina refrigerata', 'abbattitori', 'abbattitore',
    'magazzini frigoriferi', 'magazzino frigorifero', 'tunnel di surgelazione',
    'refrigerazione per supermercati', 'grande distribuzione', 'gdo', 'haccp',
    'climatizzazione industriale', 'refrigerazione alimentare', 'catena del freddo',
    'celle per ristorazione', 'impianti hccp',
  ],
  negatives: [
    'elettrodomestici', 'riparazione elettrodomestici', 'assistenza elettrodomestici',
    'frigoriferi domestici', 'frigorifero domestico', 'frigorifero di casa', 'frigo di casa',
    'elettrodomestico', 'riparazione frigoriferi a domicilio', 'lavatrici', 'lavastoviglie',
  ],
}

// Refrigerazione DOMESTICA (caso opposto, se un cliente la chiede esplicitamente).
const REFRIGERATION_DOMESTIC: SubtypeIntent = {
  domain: 'refrigerazione',
  qualifier: 'domestico',
  label: 'frigorista domestico',
  positives: REFRIGERATION_INDUSTRIAL.negatives,
  negatives: REFRIGERATION_INDUSTRIAL.positives,
}

// Token che identificano il dominio "refrigerazione/frigorista".
const REFRIGERATION_DOMAIN_TOKENS = ['frigorist', 'refrigeraz', 'frigorifer', 'freddo', 'climatizzaz']
const INDUSTRIAL_QUALIFIER_TOKENS = ['industrial', 'commercial', 'gdo', 'supermerc']
const DOMESTIC_QUALIFIER_TOKENS = ['domestic', 'casaling', 'elettrodomestic', 'privat']

/**
 * Rileva l'intento di sotto-tipo dalla query utente.
 * Ritorna null se non c'è un qualificatore riconosciuto (→ refinement disattivato).
 */
export function detectSubtypeIntent(query: string): SubtypeIntent | null {
  const q = normalize(query)
  if (!q) return null

  const isRefrigeration = REFRIGERATION_DOMAIN_TOKENS.some((t) => q.includes(t))
  if (isRefrigeration) {
    const wantsIndustrial = INDUSTRIAL_QUALIFIER_TOKENS.some((t) => q.includes(t))
    const wantsDomestic = DOMESTIC_QUALIFIER_TOKENS.some((t) => q.includes(t))
    // Se chiede entrambi o nessuno, non filtriamo (ambiguo → no-op sicuro).
    if (wantsIndustrial && !wantsDomestic) return REFRIGERATION_INDUSTRIAL
    if (wantsDomestic && !wantsIndustrial) return REFRIGERATION_DOMESTIC
  }

  return null
}

/**
 * Classifica un testo (contenuto del sito) rispetto all'intento richiesto.
 * - 'match'    → il testo conferma il sotto-tipo richiesto (presente almeno 1 positivo).
 * - 'opposite' → nessun positivo ma presente almeno 1 negativo (sotto-tipo opposto).
 * - 'unknown'  → nessuna prova in nessuna direzione.
 */
export function classifyTextBySubtype(text: string, intent: SubtypeIntent): SubtypeClassification {
  const hay = normalize(text)
  if (!hay) return { verdict: 'unknown', matchedPositives: [], matchedNegatives: [] }

  const matchedPositives = intent.positives.filter((p) => phraseMatches(hay, p))
  const matchedNegatives = intent.negatives.filter((n) => phraseMatches(hay, n))

  // I positivi specifici (frasi multi-parola) hanno priorità: confermano il sotto-tipo.
  if (matchedPositives.length > 0) {
    return { verdict: 'match', matchedPositives, matchedNegatives }
  }
  if (matchedNegatives.length > 0) {
    return { verdict: 'opposite', matchedPositives, matchedNegatives }
  }
  return { verdict: 'unknown', matchedPositives: [], matchedNegatives: [] }
}
