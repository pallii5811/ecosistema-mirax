/**
 * Search Agent — entry point NLP + hybrid search (delega a server actions).
 */

import {
  expandAndSearch,
  processSemanticSearchAction,
  textToFilterSearchAction,
} from '@/app/dashboard/actions'

export type SearchAgentMode = 'nlp' | 'semantic' | 'expand'

export type SearchAgentInput = {
  query: string
  mode?: SearchAgentMode
}

export async function runSearchAgent(input: SearchAgentInput) {
  const query = String(input.query ?? '').trim()
  if (!query) {
    return { ok: false as const, error: 'Query vuota' }
  }

  const mode = input.mode ?? 'nlp'

  if (mode === 'expand') {
    const data = await expandAndSearch(query)
    return { ok: true as const, mode, data }
  }

  if (mode === 'semantic') {
    const data = await processSemanticSearchAction(query)
    return { ok: true as const, mode, data }
  }

  const data = await textToFilterSearchAction(query)
  return { ok: true as const, mode: 'nlp' as const, data }
}
