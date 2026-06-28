import type { MiraxSignalRequirement } from '@/lib/signal-intent/types'

export const SIGNAL_REQUIREMENT_META: Record<
  MiraxSignalRequirement,
  { label: string; description: string }
> = {
  hiring: {
    label: 'Assunzioni',
    description: 'Offerte di lavoro o crescita organico rilevata',
  },
  registry_change: {
    label: 'Registro',
    description: 'Variazioni fatturato/dipendenti da Camera di Commercio',
  },
  sector_investment: {
    label: 'Investimento settore',
    description: 'Evidenze sul sito o categoria legate al tema richiesto',
  },
  tender_won: {
    label: 'Gara vinta',
    description: 'Aggiudicazioni / appalti pubblici rilevati',
  },
  crm_detected: {
    label: 'CRM rilevato',
    description: 'Stack CRM presente sul sito (HubSpot, Salesforce, …)',
  },
  crm_change: {
    label: 'Cambio CRM',
    description: 'Variazione stack CRM rispetto audit precedente',
  },
  site_stale: {
    label: 'Sito datato',
    description: 'Sito lento o non aggiornato',
  },
  meta_ads_started: {
    label: 'Ads Meta',
    description: 'Inserzioni Meta attive',
  },
  google_ads_started: {
    label: 'Google Ads',
    description: 'Tag Google Ads sul sito',
  },
  investing_marketing: {
    label: 'Investe in marketing',
    description: 'Budget ads / tracking già attivo',
  },
}

/** Pattern NL → requirement (heuristic, zero LLM). */
export const NL_SIGNAL_PATTERNS: Array<{
  requirement: MiraxSignalRequirement
  patterns: RegExp[]
}> = [
  {
    requirement: 'hiring',
    patterns: [
      /\b(assum|assunz|assumendo|assunzioni|assumono|offerte?\s+(di\s+)?lavoro|job\s+open|recruit\w*|hiring|personale)\b/i,
      /\b(programmator|developer|commercial|venditor|marketing\s+manager|tecnici|infermier)\b/i,
    ],
  },
  {
    requirement: 'registry_change',
    patterns: [
      /\b(registro|camera\s+di\s+commercio|bilancio|fatturato|crescita\s+organico|dipendenti\s+in\s+aumento)\b/i,
    ],
  },
  {
    requirement: 'sector_investment',
    patterns: [
      /\b(invest|investono|investimento|puntano\s+su|espansione\s+in)\b/i,
      /\b(fotovoltaic|fotovoltaico|pannelli\s+solari|impianti\s+solari|solare|rinnovabil|energia\s+pulita)\b/i,
      /\b(intelligenza\s+artificiale|\bai\b|machine\s+learning|automazion)\b/i,
    ],
  },
  {
    requirement: 'tender_won',
    patterns: [
      /\b(gara|appalto|aggiudicat\w*|vincit\w*|bando\s+pubblic\w*|lavori\s+pubblici|pubblica\s+amministrazione|anac|mepa)\b/i,
    ],
  },
  {
    requirement: 'crm_change',
    patterns: [
      /\b(cambiat\w*\s+crm|nuovo\s+crm|migrat\w*\s+(a|su|verso|da)?|switch\s+crm|sostituit\w*\s+crm)\b/i,
    ],
  },
  {
    requirement: 'crm_detected',
    patterns: [
      /\b(crm|hubspot|salesforce|pipedrive|zoho|dynamics\s+365|freshsales)\b/i,
    ],
  },
  {
    requirement: 'investing_marketing',
    patterns: [
      /\b(investono\s+in\s+marketing|budget\s+marketing|spendono\s+in\s+pubblicit\w*)\b/i,
    ],
  },
  {
    requirement: 'google_ads_started',
    patterns: [/\bgoogle\s+ads\b/i, /\bcampagne\s+google\b/i],
  },
  {
    requirement: 'meta_ads_started',
    patterns: [/\bmeta\s+ads\b/i, /\b(facebook\s+ads|instagram\s+ads)\b/i],
  },
  {
    requirement: 'site_stale',
    patterns: [
      /\b(sito\s+lento|sito\s+datato|sito\s+vecchio|sito\s+non\s+aggiornato|web\s+obsolet\w*|copyright\s+datato)\b/i,
      /\b(caricamento\s+lento|performance\s+sito)\b/i,
    ],
  },
]

export const HIRING_ROLE_PATTERNS: Array<{ role: string; patterns: RegExp[] }> = [
  { role: 'programmatore', patterns: [/\b(programmator\w*|developer|sviluppat\w*|software|full[\s-]?stack|backend|frontend)\b/i] },
  { role: 'commerciale', patterns: [/\b(commercial\w*|venditor\w*|sales|account\s+manager|business\s+developer)\b/i] },
  { role: 'marketing', patterns: [/\b(marketing|social\s+media|seo|copywriter|growth)\b/i] },
  { role: 'tecnico', patterns: [/\b(tecnico|tecnici|installator\w*|manutentor\w*|operai|murator\w*)\b/i] },
  { role: 'hr', patterns: [/\b(risorse\s+umane|hr|recruiter|talent)\b/i] },
]

export const SECTOR_KEYWORD_EXTRACTORS: Array<{ keyword: string; patterns: RegExp[] }> = [
  { keyword: 'fotovoltaico', patterns: [/\bfotovoltaic|\bpannelli\s+solari|\bimpianti\s+solari|\benergia\s+solare|\bimpianti\s+fotovoltaic/i] },
  { keyword: 'edilizia', patterns: [/\bedil|\bcostruzion|\bristrutturaz|\bimpresa\s+edil/i] },
  { keyword: 'logistica', patterns: [/\blogistic|\btrasport|\bspedizion/i] },
  { keyword: 'software', patterns: [/\bsoftware|\bsaas|\bcloud|\bdigital/i] },
  { keyword: 'turismo', patterns: [/\bturismo|\bhotel|\bristorazion/i] },
  { keyword: 'sanita', patterns: [/\bsanit|\bclinic|\bospedal|\bmedici/i] },
]

export const CRM_KEYWORD_EXTRACTORS: Array<{ crm: string; patterns: RegExp[] }> = [
  { crm: 'hubspot', patterns: [/\bhubspot\b/i] },
  { crm: 'salesforce', patterns: [/\bsalesforce\b/i] },
  { crm: 'pipedrive', patterns: [/\bpipedrive\b/i] },
  { crm: 'zoho', patterns: [/\bzoho\b/i] },
  { crm: 'dynamics', patterns: [/\bdynamics\s*365\b/i] },
]
