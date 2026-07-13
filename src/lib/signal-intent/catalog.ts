import type { MiraxSignalRequirement } from '@/lib/signal-intent/types'

export const SIGNAL_REQUIREMENT_META: Record<
  MiraxSignalRequirement,
  { label: string; description: string }
> = {
  hiring: {
    label: 'Assunzioni',
    description: 'Offerte di lavoro o crescita organico rilevata',
  },
  hiring_operational: {
    label: 'Assunzioni operative',
    description: 'Ruoli operativi, tecnici, di cantiere, logistica o produzione aperti',
  },
  hiring_technology: {
    label: 'Assunzioni tech',
    description: 'Ruoli software, dati, IT o cybersecurity aperti',
  },
  hiring_sales: {
    label: 'Assunzioni sales',
    description: 'Ruoli commerciali, vendite o business development aperti',
  },
  hiring_marketing: {
    label: 'Assunzioni marketing',
    description: 'Ruoli marketing, advertising, content o growth aperti',
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
  funding_received: {
    label: 'Finanziamento',
    description: 'Round di investimento o finanziamento rilevato',
  },
  crm_detected: {
    label: 'CRM rilevato',
    description: 'Stack CRM presente sul sito (HubSpot, Salesforce, …)',
  },
  crm_change: {
    label: 'Cambio CRM',
    description: 'Variazione stack CRM rispetto audit precedente',
  },
  crm_installed: {
    label: 'CRM installato',
    description: 'Nuova installazione CRM rilevata',
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
  seeking_supplier: {
    label: 'Cerca fornitore',
    description: 'Evidenze di ricerca fornitori o appalto',
  },
  expansion: {
    label: 'Espansione',
    description: 'Apertura sedi, crescita geografica o team',
  },
  fleet_expansion: {
    label: 'Espansione flotta',
    description: 'Acquisto o crescita recente di veicoli e asset mobili',
  },
  production_expansion: {
    label: 'Espansione produttiva',
    description: 'Ampliamento di impianti, stabilimenti, capannoni o capacità produttiva',
  },
  new_location: {
    label: 'Nuova sede',
    description: 'Apertura o trasferimento verificabile di una nuova sede operativa',
  },
  executive_change: {
    label: 'Cambio dirigenza',
    description: 'Nuovo CEO, direttore o amministratore',
  },
  investing_expansion: {
    label: 'Investe in espansione',
    description: 'Segnali di crescita organica o geografica',
  },
  new_product: {
    label: 'Nuovo prodotto',
    description: 'Lancio prodotto/servizio rilevato',
  },
  market_entry: {
    label: 'Nuovo mercato',
    description: 'Entrata in nuovo mercato o settore',
  },
  new_company: {
    label: 'Nuova impresa',
    description: 'Costituzione o apertura recente — ideale per commercialisti/consulenti',
  },
  tech_migration: {
    label: 'Migrazione tech',
    description: 'Digital transformation, cloud, stack obsoleto',
  },
  manual_processes: {
    label: 'Processi manuali',
    description: 'Workflow esplicitamente manuali, frammentati o basati su fogli di calcolo',
  },
  cybersecurity_exposure: {
    label: 'Esposizione cyber',
    description: 'Superficie web, ecommerce, posta o servizi digitali con rischio tecnico verificabile',
  },
  regulatory_change: {
    label: 'Cambio normativo',
    description: 'Nuovi requisiti, obblighi o adeguamenti normativi verificabili',
  },
}

/** Pattern NL → requirement (heuristic, zero LLM). */
export const NL_SIGNAL_PATTERNS: Array<{
  requirement: MiraxSignalRequirement
  patterns: RegExp[]
}> = [
  {
    requirement: 'hiring_technology',
    patterns: [
      /\b(?:assunz\w*|assum\w*|hiring|job\s+open|ruoli?)\s+(?:tech|tecnolog\w*|software|it|ict|digital\w*|developer|sviluppator\w*|data|cyber\w*)\b/i,
      /\b(?:developer|sviluppator\w*|software\s+engineer|data\s+(?:engineer|scientist|analyst)|cybersecurity|sistemist\w*)\s+(?:ricercat\w*|in\s+assunzione|apert\w*)\b/i,
    ],
  },
  {
    requirement: 'hiring_sales',
    patterns: [
      /\b(?:assunz\w*|assum\w*|hiring|job\s+open|ruoli?)\s+(?:sales|commercial\w*|venditor\w*|account\s+manager|business\s+developer)\b/i,
      /\b(?:sales|commercial\w*|venditor\w*|account\s+manager|business\s+developer)\s+(?:ricercat\w*|in\s+assunzione|apert\w*)\b/i,
    ],
  },
  {
    requirement: 'hiring_marketing',
    patterns: [
      /\b(?:assunz\w*|assum\w*|hiring|job\s+open|ruoli?)\s+(?:marketing|growth|seo|content|social\s+media|advertising)\b/i,
      /\b(?:marketing\s+manager|growth\s+manager|seo\s+specialist|content\s+manager)\s+(?:ricercat\w*|in\s+assunzione|apert\w*)\b/i,
    ],
  },
  {
    requirement: 'hiring_operational',
    patterns: [
      /\b(?:assunz\w*|assum\w*|personale|ruoli?)\s+(?:operativ\w*|di\s+cantiere|di\s+produzione|di\s+magazzino)\b/i,
      /\b(?:operai|autisti|magazzinieri|installatori|manutentori|tecnici)\s+(?:ricercati|cercati|in\s+assunzione)\b/i,
    ],
  },
  {
    requirement: 'hiring',
    patterns: [
      /\b(assum|assunz|assumendo|assunzioni|assumono|offerte?\s+(di\s+)?lavoro|job\s+open|recruit\w*|hiring|personale)\b/i,
      /\b(?:cerca|ricerca|assume)\s+(?:programmator\w*|developer|commercial\w*|venditor\w*|marketing\s+manager|seo|copywriter|growth|tecnici|infermier\w*)\b/i,
      /\b(?:programmator\w*|developer|commercial\w*|venditor\w*|marketing\s+manager|seo|copywriter|growth|tecnici|infermier\w*)\s+(?:ricercat\w*|cercat\w*|in\s+assunzione)\b/i,
    ],
  },
  {
    requirement: 'registry_change',
    patterns: [
      /\b(registro|camera\s+di\s+commercio|bilancio|crescita\s+organico|dipendenti\s+in\s+aumento|cambi\w*\s+societari\w*|variazion\w*\s+societari\w*)\b/i,
    ],
  },
  {
    requirement: 'new_company',
    patterns: [
      /\b(nuova\s+(?:azienda|impresa|societ[aà]|apertura)|costituzion\w*\s+(?:societari|di\s+impresa)|appena\s+(?:fondata|costituita))(?=\s|$|[,.;])/i,
    ],
  },
  {
    requirement: 'sector_investment',
    patterns: [
      /\b(aumento\s+di\s+capitale|ricapitalizzazion\w*)\b/i,
    ],
  },
  {
    requirement: 'tender_won',
    patterns: [
      /\b(gara|appalto|aggiudicat\w*|vincit\w*|bando\s+pubblic\w*|lavori\s+pubblici|pubblica\s+amministrazione|anac|mepa)\b/i,
    ],
  },
  {
    requirement: 'funding_received',
    patterns: [
      /\b(finanziamento|funding|round\s+di|venture\s+capital|seed\s+round|startup\s+finanziata)\b/i,
    ],
  },
  {
    requirement: 'crm_installed',
    patterns: [
      /\b(crm\s+installato|installato\s+crm|nuovo\s+crm|ha\s+appena\s+messo\s+crm)\b/i,
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
    requirement: 'tech_migration',
    patterns: [
      /\b(?:migrazion\w*|migrat\w*)\s+(?:software|tecnolog\w*|piattaform\w*|gestional\w*|erp|crm|cloud|stack)\b/i,
      /\b(?:cambio|sostituzion\w*|switch)\s+(?:software|piattaform\w*|gestional\w*|erp|crm|stack)\b/i,
    ],
  },
  {
    requirement: 'manual_processes',
    patterns: [
      /\b(?:process\w*|workflow)\s+(?:manual\w*|frammentat\w*|su\s+excel|su\s+fogli\s+di\s+calcolo)\b/i,
      /\b(?:excel|fogli\s+di\s+calcolo)\s+(?:manual\w*|per\s+gestire|come\s+gestionale)\b/i,
    ],
  },
  {
    requirement: 'cybersecurity_exposure',
    patterns: [
      /\b(?:esposizion\w*|superficie)\s+(?:web|cyber\w*|digital\w*|internet|ecommerce|posta)\b/i,
      /\b(?:vulnerabilit[aà]|rischio\s+cyber|servizi\s+esposti|posta\s+esposta|ecommerce\s+esposto)\b/i,
    ],
  },
  {
    requirement: 'regulatory_change',
    patterns: [
      /\b(?:nuov\w*\s+requisit\w*|requisit\w*\s+ambiental\w*|normativ\w*\s+ambiental\w*|adeguament\w*\s+(?:normativ\w*|ambiental\w*)|obbligh\w*\s+ambiental\w*)\b/i,
    ],
  },
  {
    requirement: 'investing_marketing',
    patterns: [
      /\b(invest\w*\s+in\s+marketing|budget\s+marketing|spendono\s+in\s+pubblicit\w*|campagne\s+attive|landing\s+page|lead\s+ads)\b/i,
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
      /\b(sito\s+lento|sito\s+datato|sito\s+vecchio|sito\s+debole|sito\s+inefficace|sito\s+non\s+aggiornato|web\s+obsolet\w*|copyright\s+datato)\b/i,
      /\b(caricamento\s+lento|performance\s+sito)\b/i,
    ],
  },
  {
    requirement: 'seeking_supplier',
    patterns: [
      /\b(cercano\s+fornitor\w*|cerchiamo\s+fornitor\w*|albo\s+fornitor\w*|richiesta\s+preventiv\w*|manifestazione\s+di\s+interesse)\b/i,
    ],
  },
  {
    requirement: 'fleet_expansion',
    patterns: [
      /\bflott\w*\s+(?:in\s+)?(?:espansion\w*|crescita|aument\w*)\b/i,
      /\b(?:nuov\w*|acquist\w*|aggiunt\w*)\s+(?:veicol\w*|mezzi|automezzi)\b/i,
    ],
  },
  {
    requirement: 'production_expansion',
    patterns: [
      /\b(?:impiant\w*|process\w*\s+industrial\w*)[^.;]{0,80}\b(?:espansion\w*|ampliament\w*|aument\w*)\b/i,
      /\b(?:sed[ei]|impiant\w*|stabiliment\w*|capannon\w*|capacit[aà])\s+(?:produttiv\w*|industrial\w*)[^.;]{0,60}\b(?:espansion\w*|ampliament\w*|crescita|aument\w*)\b/i,
      /\b(?:espansion\w*|ampliament\w*|aument\w*)[^.;]{0,60}\b(?:produzion\w*|capacit[aà]\s+produttiv\w*|stabiliment\w*|impiant\w*)\b/i,
    ],
  },
  {
    requirement: 'new_location',
    patterns: [
      /\b(?:nuova\s+sede|nuove\s+sedi|apertura\s+sede|trasferimento\s+sede|nuovo\s+stabilimento)\b/i,
    ],
  },
  {
    requirement: 'expansion',
    patterns: [
      /\b(nuova\s+apertura|espansion\w*\s+(?:geografic\w*|territorial\w*)|ampliamento\s+(?:sede|stabilimento|rete)|crescita\s+geografic\w*)\b/i,
    ],
  },
  {
    requirement: 'new_product',
    patterns: [
      /\b(nuovo\s+prodotto|nuovo\s+servizio|lancio\s+prodotto|lancia\s+una\s+nuova)\b/i,
    ],
  },
  {
    requirement: 'market_entry',
    patterns: [
      /\b(nuovo\s+mercato|nuovi\s+mercati|entra\s+nel\s+mercato|internazionalizz\w*)\b/i,
    ],
  },
  {
    requirement: 'investing_expansion',
    patterns: [
      /\b(fiera|expo|evento\s+b2b|stand|webinar|sponsor|nuova\s+partnership|accordo\s+commerciale)\b/i,
    ],
  },
]

export const HIRING_ROLE_PATTERNS: Array<{ role: string; patterns: RegExp[] }> = [
  { role: 'programmatore', patterns: [/\b(programmator\w*|developer|sviluppat\w*|software|full[\s-]?stack|backend|frontend)\b/i] },
  { role: 'commerciale', patterns: [/\b(commercial(?!ista|isti|iste)\w*|venditor\w*|sales|account\s+manager|business\s+developer)\b/i] },
  { role: 'marketing', patterns: [/\b(marketing|social\s+media|seo|copywriter|growth)\b/i] },
  { role: 'tecnico', patterns: [/\b(tecnico|tecnici|installator\w*|manutentor\w*|operai|murator\w*)\b/i] },
  { role: 'hr', patterns: [/\b(risorse\s+umane|hr|recruiter|talent)\b/i] },
]

export const SECTOR_KEYWORD_EXTRACTORS: Array<{ keyword: string; patterns: RegExp[] }> = [
  { keyword: 'fotovoltaico', patterns: [/\bfotovoltaic|\bpannelli\s+solari|\bimpianti\s+solari|\benergia\s+solare|\bimpianti\s+fotovoltaic/i] },
  { keyword: 'edilizia', patterns: [/\bedil|\bcostruzion|\bristrutturaz|\bimpresa\s+edil/i] },
  { keyword: 'logistica', patterns: [/\blogistic|\btrasport|\bspedizion/i] },
  { keyword: 'software', patterns: [/\bsoftware|\bsaas|\bcloud|\bdigital/i] },
  { keyword: 'intelligenza artificiale', patterns: [/\bintelligenza\s+artificiale\b|\bmachine\s+learning\b|\bAI\b/i] },
  { keyword: 'automazione', patterns: [/\bautomazion\w*\b|\bindustria\s+4\.0\b/i] },
  { keyword: 'turismo', patterns: [/\bturismo|\bhotel/i] },
  { keyword: 'ristorazione', patterns: [/\bristorazion|\bristorant/i] },
  { keyword: 'sanita', patterns: [/\bsanit|\bclinic|\bospedal|\bmedici/i] },
]

export const CRM_KEYWORD_EXTRACTORS: Array<{ crm: string; patterns: RegExp[] }> = [
  { crm: 'hubspot', patterns: [/\bhubspot\b/i] },
  { crm: 'salesforce', patterns: [/\bsalesforce\b/i] },
  { crm: 'pipedrive', patterns: [/\bpipedrive\b/i] },
  { crm: 'zoho', patterns: [/\bzoho\b/i] },
  { crm: 'dynamics', patterns: [/\bdynamics\s*365\b/i] },
]
