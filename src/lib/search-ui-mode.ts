const WEB_RESEARCH_SIGNALS = new Set([
  'hiring',
  'expansion',
  'funding_received',
  'tender_won',
  'sector_investment',
  'investing_marketing',
  'meta_ads_started',
  'google_ads_started',
  'registry_change',
  'crm_change',
])

function hasWebResearchSignal(intent: unknown): boolean {
  if (!intent || typeof intent !== 'object') return false
  const raw = (intent as { required_signals?: unknown }).required_signals
  if (!Array.isArray(raw)) return false
  return raw.some((value) => WEB_RESEARCH_SIGNALS.has(String(value || '').trim().toLowerCase()))
}

/**
 * Decide quale esperienza mostrare durante una search pending.
 *
 * Regola prodotto:
 * - query con segnali d'acquisto web (assunzioni, investimenti, gare, marketing spend)
 *   devono comunicare "Agente AI / web research", non "Maps";
 * - query categoria+città o audit tecnico locale restano Maps;
 * - se il debug backend è parziale, il parsed intent offline fa da cintura di sicurezza.
 */
export function shouldUseAgenticSearchUi(aiDebug: unknown, parsedIntent: unknown): boolean {
  const debug = aiDebug && typeof aiDebug === 'object' ? (aiDebug as Record<string, unknown>) : {}
  const strategy = String(debug.search_strategy ?? '').toLowerCase()
  const source = String(debug.source ?? '').toLowerCase()
  const explicitMaps =
    strategy === 'maps' ||
    source === 'maps_worker' ||
    source === 'maps_hybrid_worker' ||
    source.includes('maps_worker')
  const explicitAgentic = strategy === 'organic_web_search' || source.includes('agentic')
  if (explicitAgentic) return true
  if (explicitMaps) return false
  return hasWebResearchSignal(parsedIntent)
}
