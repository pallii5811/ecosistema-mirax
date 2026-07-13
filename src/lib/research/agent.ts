/**
 * Fase 6 — MIRAX Research Agent (tool use + synthesis).
 * Budget cap $0.05/lead, cache 24h, nessun dato inventato.
 */

import type { MiraxSignal } from '@/lib/mirax-signals'
import { RESEARCH_SYSTEM_PROMPT } from './prompt.ts'
import { getResearchCache, researchCacheKey, setResearchCache } from './cache.ts'
import { runResearchTool } from './tools.ts'
import type {
  ResearchAgentOutput,
  ResearchLeadInput,
  ResearchToolName,
  ResearchToolResult,
} from './types.ts'

export { RESEARCH_SYSTEM_PROMPT } from './prompt.ts'

const MAX_BUDGET_USD = 0.05
const MAX_TOOL_ROUNDS = 4
const MODEL = 'gpt-4o-mini'

function isLegacyOpenAiResearchEnabled(): boolean {
  return false
}

function getLegacyOpenAiApiKey(): string {
  return ''
}

const OPENAI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_web',
      description: 'Cerca informazioni su web/news/job/gare per azienda italiana',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_page',
      description: 'Legge e estrae testo da una pagina web pubblica',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          extract_selector: { type: 'string' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_api',
      description: 'Interroga API pubbliche consentite (ANAC, OpenAPI, TED)',
      parameters: {
        type: 'object',
        properties: {
          endpoint: { type: 'string' },
          params: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['endpoint'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'verify_fact',
      description: 'Verifica un claim confrontando più fonti URL',
      parameters: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['claim', 'sources'],
      },
    },
  },
]

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, '').trim())
  } catch {
    return null
  }
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  // gpt-4o-mini ~ $0.15/1M in, $0.60/1M out
  return (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.6
}

function severityFromConfidence(c: number): MiraxSignal['severity'] {
  if (c >= 80) return 'critical'
  if (c >= 60) return 'high'
  return 'medium'
}

function rawSignalsToMirax(raw: unknown[]): MiraxSignal[] {
  const out: MiraxSignal[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const type = String(r.type || '').trim()
    const title = String(r.title || '').trim()
    if (!type || !title) continue
    const confidence = typeof r.confidence === 'number' ? Math.round(r.confidence) : 50
    const evidenceRaw = r.evidence
    const evidenceObj =
      evidenceRaw && typeof evidenceRaw === 'object' ? (evidenceRaw as Record<string, unknown>) : {}
    const url = typeof evidenceObj.url === 'string' ? evidenceObj.url : undefined
    const source = typeof evidenceObj.source === 'string' ? evidenceObj.source : 'research_agent'
    const date = typeof evidenceObj.date === 'string' ? evidenceObj.date : undefined
    const reasoning = typeof r.reasoning === 'string' ? r.reasoning : ''

    out.push({
      id: `research_${type}_${out.length}`,
      kind: 'business',
      signalType: type,
      title,
      severity: severityFromConfidence(confidence),
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasoning || `Segnale ${type} da research agent`,
      evidence: [
        { label: 'Fonte', value: source, source, url },
        ...(date ? [{ label: 'Data', value: date, source }] : []),
      ],
      detectedAt: date || new Date().toISOString(),
    })
  }
  return out
}

function buildInitialUserMessage(lead: ResearchLeadInput, query?: string): string {
  return `Lead target:
- Nome: ${lead.name}
- Sito: ${lead.website || 'n/d'}
- Città: ${lead.city || 'n/d'}
- Settore: ${lead.sector || 'n/d'}
- P.IVA: ${lead.piva || 'n/d'}

Query utente: ${query?.trim() || 'Trova tutti i segnali d acquisto verificabili per questo lead.'}

Usa i tool disponibili. Poi rispondi con JSON secondo lo schema richiesto.`
}

async function callOpenAIWithTools(
  messages: OpenAIMessage[],
): Promise<{ message: OpenAIMessage; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const apiKey = getLegacyOpenAiApiKey()
  if (!apiKey) throw new Error('LEGACY_RESEARCH_PROVIDER_DISABLED')

  const res = await fetch('data:,mirax-legacy-provider-removed', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages,
      tools: OPENAI_TOOLS,
      tool_choice: 'auto',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: OpenAIMessage }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const message = data.choices?.[0]?.message
  if (!message) throw new Error('Risposta OpenAI vuota')
  return { message, usage: data.usage }
}

export type ResearchAgentOptions = {
  query?: string
  skipCache?: boolean
  mock?: boolean
}

export async function runResearchAgent(
  lead: ResearchLeadInput,
  options: ResearchAgentOptions = {},
): Promise<ResearchAgentOutput> {
  const website = lead.website?.trim() || lead.name
  const cacheKey = researchCacheKey(website, options.query)

  if (!options.skipCache && !options.mock) {
    const cached = await getResearchCache(cacheKey)
    if (cached) return { ...cached, from_cache: true }
  }

  const toolsUsed: ResearchToolName[] = []
  let estimatedCost = 0
  let inputTokens = 0
  let outputTokens = 0

  if (options.mock) {
    return {
      signals: [],
      research_summary: 'Mock mode — nessuna chiamata AI.',
      model: 'mock-v1',
      from_cache: false,
      tools_used: [],
      estimated_cost_usd: 0,
    }
  }

  if (!isLegacyOpenAiResearchEnabled()) {
    return {
      signals: [],
      research_summary: 'Research agent legacy disabilitato. Usa pipeline Sonnet/Search MIRAX.',
      model: 'disabled-legacy-research',
      from_cache: false,
      tools_used: [],
      estimated_cost_usd: 0,
    }
  }

  const messages: OpenAIMessage[] = [
    { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
    { role: 'user', content: buildInitialUserMessage(lead, options.query) },
  ]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (estimatedCost >= MAX_BUDGET_USD) break

    const { message, usage } = await callOpenAIWithTools(messages)
    inputTokens += usage?.prompt_tokens ?? 800
    outputTokens += usage?.completion_tokens ?? 200
    estimatedCost = estimateCostUsd(inputTokens, outputTokens)
    if (estimatedCost >= MAX_BUDGET_USD) break

    if (message.tool_calls?.length) {
      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls })

      for (const tc of message.tool_calls) {
        const toolName = tc.function.name as ResearchToolName
        toolsUsed.push(toolName)
        let params: Record<string, unknown> = {}
        try {
          params = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
        } catch {
          params = {}
        }
        const result: ResearchToolResult = await runResearchTool(toolName, params as never)
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: toolName,
          content: JSON.stringify(result).slice(0, 6000),
        })
      }
      continue
    }

    const rawContent = message.content || ''
    const parsed = safeJsonParse(rawContent) as Record<string, unknown> | null
    const signals = rawSignalsToMirax(Array.isArray(parsed?.signals) ? parsed!.signals : [])
    const research_summary =
      typeof parsed?.research_summary === 'string'
        ? parsed.research_summary
        : signals.length > 0
          ? `${signals.length} segnali verificati.`
          : 'Nessun segnale verificabile trovato.'

    const output: ResearchAgentOutput = {
      signals,
      research_summary,
      model: MODEL,
      from_cache: false,
      tools_used: [...new Set(toolsUsed)],
      estimated_cost_usd: Math.round(estimatedCost * 10000) / 10000,
    }

    if (!options.skipCache) await setResearchCache(cacheKey, website, output)
    return output
  }

  const fallback: ResearchAgentOutput = {
    signals: [],
    research_summary: 'Budget ricerca esaurito o limite tool raggiunto — usa waterfall strutturato.',
    model: MODEL,
    from_cache: false,
    tools_used: [...new Set(toolsUsed)],
    estimated_cost_usd: Math.round(estimatedCost * 10000) / 10000,
  }
  return fallback
}
