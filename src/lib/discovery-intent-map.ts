/**
 * Mapping intent "Cosa vendi?" → query ricerca Maps (Discovery mode).
 * Mappa statica IT — zero LLM, zero latenza.
 */

export type DiscoveryIntentId =
  | 'siti_web'
  | 'marketing_ads'
  | 'seo'
  | 'social_media'
  | 'branding'
  | 'software_saas'
  | 'consulenza_b2b'

export type DiscoveryIntent = {
  id: DiscoveryIntentId
  label: string
  hint: string
  /** Categoria di default se l'utente non specifica settore */
  defaultCategory: string
  /** Suffisso filtro da appendere alla query */
  filterSuffix: string
  placeholderCategory: string
}

export const DISCOVERY_INTENTS: DiscoveryIntent[] = [
  {
    id: 'siti_web',
    label: 'Siti web e landing',
    hint: 'Aziende senza sito o con sito datato',
    defaultCategory: 'imprese edili',
    filterSuffix: 'senza sito',
    placeholderCategory: 'es. ristoranti, studi medici, edili…',
  },
  {
    id: 'marketing_ads',
    label: 'Pubblicità online (Meta/Google)',
    hint: 'Chi non fa ads o spreca budget',
    defaultCategory: 'aziende',
    filterSuffix: 'senza Google Ads',
    placeholderCategory: 'es. negozi, palestre, hotel…',
  },
  {
    id: 'seo',
    label: 'SEO e visibilità Google',
    hint: 'Siti con problemi SEO',
    defaultCategory: 'imprese',
    filterSuffix: 'errori SEO',
    placeholderCategory: 'es. avvocati, dentisti, artigiani…',
  },
  {
    id: 'social_media',
    label: 'Social media management',
    hint: 'Business senza presenza social',
    defaultCategory: 'ristoranti',
    filterSuffix: 'senza Instagram',
    placeholderCategory: 'es. bar, parrucchieri, hotel…',
  },
  {
    id: 'branding',
    label: 'Brand e identità visiva',
    hint: 'Aziende con sito lento o datato',
    defaultCategory: 'aziende',
    filterSuffix: 'sito lento',
    placeholderCategory: 'es. studi professionali, negozi…',
  },
  {
    id: 'software_saas',
    label: 'Software / automazioni',
    hint: 'Aziende strutturate poco digitalizzate',
    defaultCategory: 'imprese',
    filterSuffix: 'senza Analytics',
    placeholderCategory: 'es. PMI, studi, agenzie…',
  },
  {
    id: 'consulenza_b2b',
    label: 'Consulenza B2B generica',
    hint: 'Lead locali con contatto disponibile',
    defaultCategory: 'imprese',
    filterSuffix: '',
    placeholderCategory: 'es. aziende manifatturiere, servizi…',
  },
]

export const DISCOVERY_INTENTS_ES: DiscoveryIntent[] = [
  {
    id: 'siti_web',
    label: 'Webs y landing pages',
    hint: 'Empresas sin web o con sitio desactualizado',
    defaultCategory: 'empresas de construcción',
    filterSuffix: 'sin web',
    placeholderCategory: 'ej. restaurantes, clínicas, reformas…',
  },
  {
    id: 'marketing_ads',
    label: 'Publicidad online (Meta/Google)',
    hint: 'Quienes no hacen ads o desperdician presupuesto',
    defaultCategory: 'empresas',
    filterSuffix: 'sin Google Ads',
    placeholderCategory: 'ej. tiendas, gimnasios, hoteles…',
  },
  {
    id: 'seo',
    label: 'SEO y visibilidad Google',
    hint: 'Sitios con problemas SEO',
    defaultCategory: 'empresas',
    filterSuffix: 'errores SEO',
    placeholderCategory: 'ej. abogados, dentistas, artesanos…',
  },
  {
    id: 'social_media',
    label: 'Gestión de redes sociales',
    hint: 'Negocios sin presencia social',
    defaultCategory: 'restaurantes',
    filterSuffix: 'sin Instagram',
    placeholderCategory: 'ej. bares, peluquerías, hoteles…',
  },
  {
    id: 'branding',
    label: 'Marca e identidad visual',
    hint: 'Empresas con web lenta o antigua',
    defaultCategory: 'empresas',
    filterSuffix: 'web lenta',
    placeholderCategory: 'ej. estudios profesionales, tiendas…',
  },
  {
    id: 'software_saas',
    label: 'Software / automatizaciones',
    hint: 'Empresas poco digitalizadas',
    defaultCategory: 'empresas',
    filterSuffix: 'sin Analytics',
    placeholderCategory: 'ej. pymes, estudios, agencias…',
  },
  {
    id: 'consulenza_b2b',
    label: 'Consultoría B2B',
    hint: 'Leads locales con contacto disponible',
    defaultCategory: 'empresas',
    filterSuffix: '',
    placeholderCategory: 'ej. industria, servicios…',
  },
]

export function getDiscoveryIntentsForLocale(locale: 'it' | 'es'): DiscoveryIntent[] {
  return locale === 'es' ? DISCOVERY_INTENTS_ES : DISCOVERY_INTENTS
}

export function getDiscoveryIntent(id: string, locale: 'it' | 'es' = 'it'): DiscoveryIntent | undefined {
  return getDiscoveryIntentsForLocale(locale).find((i) => i.id === id)
}

/** Costruisce query naturale per processSemanticSearchAction. */
export function buildDiscoverySearchQuery(input: {
  intentId: DiscoveryIntentId
  city: string
  category?: string
  locale?: 'it' | 'es'
}): string {
  const intent = getDiscoveryIntent(input.intentId, input.locale ?? 'it')
  if (!intent) return `${input.category || 'imprese'} ${input.city}`.trim()

  const city = input.city.trim()
  const category = (input.category || intent.defaultCategory).trim()
  const parts = [`${category} ${city}`]
  if (intent.filterSuffix) parts.push(intent.filterSuffix)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
