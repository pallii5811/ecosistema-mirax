/**
 * Catalogo API v1 per integrazioni Jarvis / automazioni esterne.
 */

export const MIRAX_API_V1_BASE = '/api/v1'

export const JARVIS_API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/v1/status',
    description: 'Health check + versione API (no auth)',
  },
  {
    method: 'GET',
    path: '/api/v1/leads',
    auth: 'Bearer mx_…',
    query: 'categoria, citta, no_pixel, min_score, limit, page',
    description: 'Lead da ricerche completate per categoria e città',
  },
  {
    method: 'POST',
    path: '/api/v1/leads',
    auth: 'Bearer mx_…',
    description: 'Inserisce un lead nel CRM MIRAX',
  },
  {
    method: 'GET',
    path: '/api/v1/outreach',
    auth: 'Bearer mx_…',
    query: 'channel, status, limit, page',
    description: 'Storico outreach dell\'utente',
  },
  {
    method: 'POST',
    path: '/api/v1/classify-reply',
    auth: 'Bearer mx_…',
    body: '{ replySnippet, leadName?, leadWebsite? }',
    description: 'Classifica risposta email (AI SDR, suggest-only)',
  },
  {
    method: 'GET',
    path: '/api/v1/pipeline',
    auth: 'Bearer mx_…',
    description: 'Deal in pipeline',
  },
  {
    method: 'GET',
    path: '/api/v1/environments',
    auth: 'Bearer mx_…',
    description: 'Ambienti / liste collegate',
  },
] as const

export const MIRAX_API_VERSION = '1.0.0'
