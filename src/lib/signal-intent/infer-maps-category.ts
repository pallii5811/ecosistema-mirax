import type { SignalIntentSpec } from '@/lib/signal-intent/types'

/**
 * Categoria Google Maps — MAI "Aziende" generico (restituisce meccaniche/idraulici a caso).
 */
export function inferMapsCategoryFromIntent(query: string, intent: SignalIntentSpec): string | null {
  const q = (query || '').trim().toLowerCase()
  if (!q) return intent.category ?? null

  const explicitCategoryPatterns: Array<[RegExp, string]> = [
    [/\bagenzie?\s+(di\s+)?viagg\w*\b/i, 'Agenzie di viaggio'],
    [/\bagenzie?\s+(di\s+)?marketing\b/i, 'Agenzie di marketing'],
    [/\bagenzie?\s+immobiliar\w*\b/i, 'Agenzie immobiliari'],
    [/\bristorant\w*\b/i, 'Ristoranti'],
    [/\bhotel\b/i, 'Hotel'],
    [/\bofficin\w*\b/i, 'Officine'],
    [/\bavvocat\w*\b/i, 'Avvocati'],
    [/\bdentist\w*\b/i, 'Dentisti'],
    [/\bidraul\w*\b/i, 'Idraulici'],
    [/\bconcessionari\w*\s+auto\b/i, 'Concessionarie auto'],
    [/\bimprese?\s+edil\w*\b/i, 'Imprese edili'],
    [/\bedil\w*\b/i, 'Imprese edili'],
    [/\bparrucchier\w*\b/i, 'Parrucchieri'],
    [/\belettricist\w*\b/i, 'Elettricisti'],
    [/\bclinic\w*\s+private\b/i, 'Cliniche private'],
    [/\b(software\s+house|web\s+agency|agenzi[ae]\s+web)\b/i, 'Software house'],
    [/\bstartup\b/i, 'Startup'],
    [/\bpmi\s+manifatturier\w*\b/i, 'PMI manifatturiere'],
  ]
  for (const [re, label] of explicitCategoryPatterns) {
    if (re.test(q)) return label
  }

  const roles = new Set(intent.hiring_roles.map((r) => r.toLowerCase()))

  // Dev / Python → settore IT su Maps (poi Indeed verifica le assunzioni)
  if (
    roles.has('programmatore') ||
    /\b(python|javascript|typescript|java\b|developer|sviluppat\w*|software|full[\s-]?stack|backend|frontend|devops)\b/i.test(q)
  ) {
    return 'Servizi informatici'
  }

  if (roles.has('marketing') || /\b(marketing\s+manager|seo\b|growth|copywriter)\b/i.test(q)) {
    return 'Agenzie di marketing'
  }

  if (roles.has('tecnico') || /\b(murator\w*|installator\w*|manutentor\w*)\b/i.test(q)) {
    return 'Imprese edili'
  }

  if (intent.sector_keywords.some((k) => /fotovoltaic|solare|rinnovabil/i.test(k)) || /\bfotovoltaic/i.test(q)) {
    return 'Impianti fotovoltaici'
  }

  if (intent.required_signals.includes('tender_won') && /\b(edil|costruzion|lavori\s+pubblici)/i.test(q)) {
    return 'Imprese edili'
  }

  if (
    intent.required_signals.includes('sector_investment') &&
    /\b(startup|scaleup|fondi|funding|finanziamento|round)\b/i.test(q)
  ) {
    return 'Startup'
  }

  // Hiring generico senza settore esplicito → non inventare "Aziende"
  return intent.category ?? null
}

export function queryNamesExplicitCategory(query: string): boolean {
  const q = (query || '').trim().toLowerCase()
  return /\b(agenzie?|ristorant|hotel|officin|avvocat|dentist|edil|immobiliar|concessionari|parrucchier|elettricist|idraul|clinic|software\s+house|web\s+agency|startup|informatic|idraul)/i.test(
    q,
  )
}

export function inferSearchKeywordsFromIntent(query: string, intent: SignalIntentSpec): string[] {
  const q = (query || '').trim().toLowerCase()
  const out: string[] = []
  if (intent.hiring_roles.includes('programmatore') || /\b(python|developer|sviluppat)\b/i.test(q)) {
    out.push('software', 'informatica', 'sviluppo', 'tech', 'programmazione')
  }
  if (intent.hiring_roles.includes('commerciale')) out.push('commerciale', 'vendite', 'sales')
  if (intent.sector_keywords.length) out.push(...intent.sector_keywords)
  if (/\bstartup\b/i.test(q)) out.push('startup', 'innovazione')
  if (/\b(fondi|funding|investimento)\b/i.test(q)) out.push('investimento', 'funding', 'finanziamento')
  return [...new Set(out)].slice(0, 8)
}

/** Chip hiring per colonna Opportunità */
export function hiringStatusForLead(
  lead: Record<string, unknown>,
  intent: SignalIntentSpec | null | undefined,
): { label: string; className: string } | null {
  if (!intent?.required_signals?.includes('hiring')) return null

  const jobs = lead.business_hiring_jobs
  const signals = lead.business_signals
  const hasConfirmed =
    (Array.isArray(jobs) && jobs.length > 0) ||
    (Array.isArray(signals) &&
      signals.some(
        (s) =>
          s &&
          typeof s === 'object' &&
          (s as Record<string, unknown>).type === 'hiring' &&
          (s as Record<string, unknown>).status !== 'unknown',
      ))

  if (hasConfirmed) {
    return { label: 'Assumono (Indeed)', className: 'bg-violet-600 text-white border-violet-700' }
  }

  if (lead.business_events_external_at) {
    return { label: 'Non assumono', className: 'bg-zinc-200 text-zinc-600 border-zinc-300' }
  }

  return { label: 'Verifica Indeed…', className: 'bg-amber-100 text-amber-900 border-amber-300' }
}
