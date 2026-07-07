/**
 * Filtro pertinenza lead rispetto alla query utente.
 * Gate deterministico (sync, zero API) + filtro AI opzionale (server-side).
 */

export type LeadLike = Record<string, unknown>

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(software\s+house|web\s+agency|agenzi[ae]\s+web|sviluppo\s+software)\b/i, 'software'],
  [/\bristorant\w*\b/i, 'ristorazione'],
  [/\bhotel\b/i, 'hotel'],
  [/\bagenzie?\s+(di\s+)?marketing\b/i, 'marketing'],
  [/\bagenzie?\b.*\bmarketing\b/i, 'marketing'],
  [/\binvest\w*\s+in\s+marketing\b/i, 'marketing'],
  [/\bstartup\b|\bscaleup\b/i, 'startup'],
  [/\bagenzie?\s+immobiliar\w*\b/i, 'immobiliare'],
  [/\b(imprese?\s+edil\w*|edil\w*|costruzion\w*)\b/i, 'edilizia'],
  [/\bofficin\w*\b/i, 'officina'],
  [/\bavvocat\w*\b/i, 'legale'],
  [/\bdentist\w*\b/i, 'dentista'],
  [/\bidraul\w*\b/i, 'idraulico'],
  [/\bparrucchier\w*\b/i, 'parrucchiere'],
  [/\belettricist\w*\b/i, 'elettricista'],
  [/\bconcessionari\w*\s+auto\b/i, 'automotive'],
  [/\bdiscotec\w*\b|\bclub\b|\blocal[ei]\s+notturn\w*\b/i, 'nightlife'],
  [/\bstartup\b/i, 'software'],
]

/** Keyword sets per categoria attesa — conflitto = lead escluso */
const CONFLICT_KEYWORDS: Record<string, RegExp[]> = {
  software: [
    /\bedil/i,
    /\bcostruz/i,
    /\bmuratur/i,
    /\bcartongess/i,
    /\bristruttur/i,
    /\bimpresa\s+edile/i,
    /\bposa\s+in\s+opera/i,
    /\bferrament/i,
    /\brestaurant/i,
    /\bristorant/i,
    /\bpizzer/i,
    /\bparrucchier/i,
    /\bdentist/i,
  ],
  ristorazione: [/\bsoftware\s+house\b/i, /\bweb\s+agency\b/i, /\bsviluppo\s+software\b/i, /\bedil/i, /\bimpresa\s+edile/i],
  edilizia: [/\bsoftware\s+house\b/i, /\bweb\s+agency\b/i, /\bsviluppo\s+software\b/i, /\bristorant/i, /\bhotel\b/i],
  marketing: [/\bedil/i, /\bimpresa\s+edile/i, /\bristorant/i, /\bdentist/i],
  startup: [/\bedil/i, /\bimpresa\s+edile/i, /\bristorant/i, /\bdentist/i, /\bparrucchier/i],
  legale: [/\bristorant/i, /\bedil/i, /\bsoftware\s+house/i],
  hotel: [/\bedil/i, /\bsoftware\s+house/i, /\bofficin/i],
  officina: [/\bsoftware\s+house/i, /\bristorant/i, /\bhotel\b/i],
  immobiliare: [/\bsoftware\s+house/i, /\bristorant/i, /\bedil/i],
  dentista: [/\bsoftware\s+house/i, /\bedil/i, /\bristorant/i],
}

/** Token osservazione `category` nel grafo Universe per categoria inferita dalla query. */
export const GRAPH_CATEGORY_TOKENS: Record<string, string> = {
  software: 'software',
  marketing: 'marketing',
  startup: 'startup',
  ristorazione: 'ristor',
  edilizia: 'edil',
  hotel: 'hotel',
  immobiliare: 'immobiliar',
  legale: 'legal',
  dentista: 'dent',
  idraulico: 'idraul',
  parrucchiere: 'parrucch',
  elettricista: 'elettric',
  automotive: 'auto',
  officina: 'officin',
  nightlife: 'club',
}

export function graphCategoryTokenForQuery(query: string): string | null {
  const key = inferQueryCategoryKey(query)
  if (!key) return null
  return GRAPH_CATEGORY_TOKENS[key] ?? null
}

const POSITIVE_KEYWORDS: Record<string, RegExp[]> = {
  software: [
    /\bsoftware\b/i,
    /\bsviluppo\b/i,
    /\bweb\b/i,
    /\bdigital/i,
    /\bit\b/i,
    /\btech\b/i,
    /\binformatic/i,
    /\bdeveloper/i,
    /\bsistemist/i,
    /\bprogramm/i,
    /\bapp\b/i,
    /\bsaas\b/i,
  ],
  edilizia: [/\bedil/i, /\bcostruz/i, /\bristruttur/i, /\bmuratur/i, /\bimpresa/i, /\bposa\b/i],
  ristorazione: [/\bristorant/i, /\bpizzer/i, /\btrattori/i, /\bosteri/i, /\bbar\b/i, /\bcucina\b/i],
  marketing: [/\bmarketing\b/i, /\bcomunicaz/i, /\bagenzia\b/i, /\bpubblicit/i, /\bsocial\s+media/i],
}

function leadText(lead: LeadLike): string {
  const parts = [
    lead.nome,
    lead.azienda,
    lead.business_name,
    lead.name,
    lead.categoria,
    lead.category,
    lead.descrizione,
    lead.description,
  ]
  return parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function inferQueryCategoryKey(query: string): string | null {
  const q = (query || '').trim()
  if (!q) return null
  for (const [re, key] of CATEGORY_PATTERNS) {
    if (re.test(q)) return key
  }
  return null
}

/** Esclude lead chiaramente fuori categoria rispetto alla query. */
export function filterLeadsDeterministic(leads: LeadLike[], query: string): LeadLike[] {
  const categoryKey = inferQueryCategoryKey(query)
  if (!categoryKey) return leads

  const conflicts = CONFLICT_KEYWORDS[categoryKey] ?? []
  const positives = POSITIVE_KEYWORDS[categoryKey] ?? []

  return leads.filter((lead) => {
    const text = leadText(lead)
    const cat = String(lead.categoria ?? lead.category ?? '').toLowerCase()

    if (!text && !cat) return positives.length === 0

    if (cat && conflicts.some((re) => re.test(cat))) return false
    if (conflicts.some((re) => re.test(text))) return false

    if (positives.length > 0) {
      const cat = String(lead.categoria ?? lead.category ?? '').toLowerCase()
      const hasPositive = positives.some((re) => re.test(text))
      if (!hasPositive && cat && conflicts.some((re) => re.test(cat))) return false
    }

    return true
  })
}

/** True se almeno il 25% dei lead passa il gate deterministico (min 1 se pool piccolo). */
export function isCacheRelevantEnough(
  leads: LeadLike[],
  query: string,
  minPassRatio = 0.25,
): boolean {
  if (!query?.trim() || leads.length === 0) return true
  const categoryKey = inferQueryCategoryKey(query)
  if (!categoryKey) return true

  const passed = filterLeadsDeterministic(leads, query)
  if (passed.length === 0) return false
  if (leads.length <= 4) return passed.length >= Math.ceil(leads.length * 0.5)
  return passed.length / leads.length > minPassRatio
}

const AI_BATCH_SIZE = 150

async function filterBatchWithAI(batch: LeadLike[], originalQuery: string): Promise<LeadLike[]> {
  if (batch.length === 0) return []

  const leadSummaries = batch.map((lead, i) => ({
    i,
    nome: String(lead.nome ?? lead.azienda ?? lead.business_name ?? lead.name ?? ''),
    categoria: String(lead.categoria ?? lead.category ?? ''),
  }))

  const prompt = `L'utente ha cercato: "${originalQuery}"

Analizza questa lista di aziende e dimmi quali sono PERTINENTI alla ricerca dell'utente.

Un'azienda è pertinente SOLO se appartiene alla stessa categoria o a una categoria strettamente correlata.

Esempi:
- Cerca "discoteche" → pertinenti: club, pub, bar, locali notturni. NON pertinenti: web agency, dentisti
- Cerca "avvocati" → pertinenti: studi legali, notai. NON pertinenti: ristoranti, palestre
- Cerca "software house" → pertinenti: software house, web agency, sviluppo software. NON pertinenti: imprese edili, ristoranti

Lista aziende:
${JSON.stringify(leadSummaries)}

Rispondi SOLO con array JSON degli indici pertinenti.
Esempio: [0,1,3,5]
Zero testo aggiuntivo. Solo l'array.`

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return batch

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0,
    }),
  })

  const data = await response.json()
  if (!data.choices?.[0]?.message?.content) {
    console.warn('[AI FILTER] OpenAI returned no choices — fallback deterministico')
    return filterLeadsDeterministic(batch, originalQuery)
  }

  const content = String(data.choices[0].message.content)
  const clean = content.replace(/```json|```/g, '').trim()
  const relevantIndices: number[] = JSON.parse(clean)

  if (relevantIndices.length === 0 && batch.length > 0) {
    console.warn('[AI FILTER] AI returned empty — nessun lead pertinente nel batch')
    return []
  }

  return batch.filter((_, i) => relevantIndices.includes(i))
}

/** Filtro completo: deterministico prima, poi AI a batch su tutti i lead. */
export async function filterLeadsWithAI(leads: LeadLike[], originalQuery: string): Promise<LeadLike[]> {
  if (leads.length === 0) return []

  const afterDeterministic = filterLeadsDeterministic(leads, originalQuery)
  if (afterDeterministic.length === 0) return []

  const out: LeadLike[] = []
  for (let i = 0; i < afterDeterministic.length; i += AI_BATCH_SIZE) {
    const batch = afterDeterministic.slice(i, i + AI_BATCH_SIZE)
    try {
      const filtered = await filterBatchWithAI(batch, originalQuery)
      out.push(...filtered)
    } catch (e) {
      console.error('[AI FILTER] Errore OpenAI batch:', e)
      out.push(...filterLeadsDeterministic(batch, originalQuery))
    }
  }
  return out
}

export async function filterLeadsForQuery(
  leads: LeadLike[],
  query: string,
  opts?: { useAI?: boolean },
): Promise<LeadLike[]> {
  const deterministic = filterLeadsDeterministic(leads, query)
  if (!opts?.useAI) return deterministic
  return filterLeadsWithAI(deterministic, query)
}
