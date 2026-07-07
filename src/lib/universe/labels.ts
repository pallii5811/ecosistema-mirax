import type { EntityType, RelationshipType, UniverseEventType } from './types.ts'

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  company: 'Azienda',
  person: 'Persona',
  website: 'Sito web',
  technology: 'Tecnologia',
  job: 'Posizione lavoro',
  event: 'Evento',
  document: 'Documento',
  product: 'Prodotto',
  location: 'Località',
  tender: 'Gara',
  investor: 'Investitore',
  product_category: 'Categoria prodotto',
}

export const RELATIONSHIP_TYPE_LABELS: Record<RelationshipType, string> = {
  owns: 'Possiede',
  uses: 'Usa',
  hires: 'Assume',
  has: 'Ha',
  receives: 'Riceve',
  buys: 'Acquista',
  competes_with: 'Compete con',
  located_in: 'Situato in',
  related_to: 'Correlato a',
  mentioned_in: 'Menzionato in',
  supplies: 'Fornisce a',
  supplied_by: 'Fornito da',
  sells_to: 'Vende a',
  buys_from: 'Compra da',
  partner_of: 'Partner di',
  invested_in: 'Ha investito in',
  received_investment_from: 'Ha ricevuto investimento da',
  customer_of: 'Cliente di',
  has_customer: 'Ha cliente',
  awarded_to: 'Aggiudicato a',
  awarded_by: 'Aggiudicato da',
  competed_for: 'Ha gareggiato per',
}

export const EVENT_TYPE_LABELS: Record<UniverseEventType, string> = {
  website_changed: 'Sito modificato',
  pixel_installed: 'Pixel installato',
  pixel_removed: 'Pixel rimosso',
  new_hiring: 'Nuova assunzione',
  new_director: 'Nuovo amministratore',
  crm_installed: 'CRM rilevato',
  crm_change: 'Cambio CRM',
  ads_started: 'Annunci attivati',
  tender_won: 'Gara vinta',
  funding_received: 'Finanziamento',
  registry_change: 'Variazione registro',
  sector_investment: 'Investimento settore',
  revenue_changed: 'Fatturato cambiato',
  employees_changed: 'Dipendenti cambiati',
  supplier_sought: 'Cerca fornitore',
  expansion_started: 'Espansione avviata',
  new_product_launched: 'Nuovo prodotto lanciato',
  market_entered: 'Nuovo mercato',
  executive_change: 'Cambio dirigenza',
  partnership_announced: 'Partnership annunciata',
}

export const OBSERVATION_LABELS: Record<string, string> = {
  meta_pixel: 'Meta Pixel',
  google_tag_manager: 'Google Tag Manager',
  google_analytics: 'Google Analytics',
  ssl: 'Certificato SSL',
  mobile_friendly: 'Mobile friendly',
  seo_disaster: 'SEO critico',
  load_speed_seconds: 'Velocità caricamento',
  rating: 'Rating Google',
  reviews_count: 'Recensioni',
  employees: 'Dipendenti',
  revenue: 'Fatturato',
  has_spf: 'SPF email',
  has_dmarc: 'DMARC',
  has_instagram: 'Instagram',
  has_facebook: 'Facebook',
  has_linkedin: 'LinkedIn',
  has_chatbot: 'Chatbot',
  has_booking: 'Booking',
  crm_stack: 'Stack CRM',
  meta_ads_running: 'Meta Ads attivi',
  google_ads_running: 'Google Ads attivi',
  last_audited_at: 'Ultimo audit',
  founded_at: 'Data costituzione',
  investing_marketing: 'Investe in marketing',
  social_followers_low: 'Social follower bassi',
}

export function labelEntityType(type: EntityType): string {
  return ENTITY_TYPE_LABELS[type] ?? type
}

export function labelRelationship(type: RelationshipType): string {
  return RELATIONSHIP_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')
}

export function labelEvent(type: UniverseEventType): string {
  return EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')
}

export function labelObservation(attr: string): string {
  return OBSERVATION_LABELS[attr] ?? attr.replace(/_/g, ' ')
}

export function formatObservationValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Sì' : 'No'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1)
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}…` : value
  if (Array.isArray(value)) return value.length ? value.slice(0, 3).join(', ') : '—'
  try {
    return JSON.stringify(value).slice(0, 80)
  } catch {
    return String(value)
  }
}

export function eventTone(type: UniverseEventType): string {
  if (type === 'new_hiring' || type === 'funding_received' || type === 'tender_won') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  }
  if (type === 'website_changed' || type === 'registry_change') {
    return 'bg-amber-50 text-amber-800 border-amber-200'
  }
  if (type === 'pixel_installed' || type === 'crm_installed') {
    return 'bg-violet-50 text-violet-800 border-violet-200'
  }
  return 'bg-slate-50 text-slate-700 border-slate-200'
}

export function entityTypeTone(type: EntityType): string {
  const map: Partial<Record<EntityType, string>> = {
    company: 'bg-violet-100 text-violet-800 border-violet-200',
    person: 'bg-sky-100 text-sky-800 border-sky-200',
    technology: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    job: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    location: 'bg-amber-100 text-amber-800 border-amber-200',
  }
  return map[type] ?? 'bg-slate-100 text-slate-700 border-slate-200'
}
