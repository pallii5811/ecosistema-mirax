export type MiraxLocale = 'it' | 'es'

export const LOCALE_STORAGE_KEY = 'mirax_locale'

export const LOCALE_LABELS: Record<MiraxLocale, string> = {
  it: 'Italiano',
  es: 'Español',
}

const messages = {
  it: {
    search_placeholder: 'Cerca in linguaggio naturale… es. aziende che assumono commerciali a Bologna',
    search_title: 'Ricerca Categoria e Città',
    discovery_title: 'Trova clienti',
    search_button: 'Cerca',
    searching: 'Ricerca...',
    credits: 'crediti',
    max_leads: 'lead',
    database_verified: 'Database verificato',
    ai_search: 'Ricerca AI',
    gdpr: 'GDPR',
    es_hint: '',
  },
  es: {
    search_placeholder: 'Busca empresas... ej. Restaurantes en Madrid sin web',
    search_title: 'Búsqueda por categoría y ciudad',
    discovery_title: 'Encuentra clientes',
    search_button: 'Buscar',
    searching: 'Buscando...',
    credits: 'créditos',
    max_leads: 'leads',
    database_verified: 'Base verificada',
    ai_search: 'Búsqueda AI',
    gdpr: 'RGPD',
    es_hint: 'Mercado España — usa ciudades en español (Madrid, Barcelona, Valencia…)',
  },
} as const

export type MessageKey = keyof typeof messages.it

export function readLocale(): MiraxLocale {
  if (typeof window === 'undefined') return 'it'
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    return raw === 'es' ? 'es' : 'it'
  } catch {
    return 'it'
  }
}

export function writeLocale(locale: MiraxLocale): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

export function t(locale: MiraxLocale, key: MessageKey): string {
  return messages[locale][key] ?? messages.it[key]
}

/** Normalizza query Maps per mercato ES (nessuna modifica al worker — città in spagnolo). */
export function searchLocaleHint(locale: MiraxLocale): string | null {
  return locale === 'es' ? messages.es.es_hint : null
}

export function mapsCountryForLocale(locale: MiraxLocale): 'IT' | 'ES' {
  return locale === 'es' ? 'ES' : 'IT'
}
