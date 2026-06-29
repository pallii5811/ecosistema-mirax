import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { gatherLeadContext } from '@/lib/claude-intent-enrich/context'
import type { ClaudeLeadEnrichment } from '@/lib/claude-intent-enrich/types'

const ENRICH_PROMPT = `Sei MIRAX Intent Enricher — analista B2B italiano.

L'UTENTE HA CHIESTO:
"{{USER_QUERY}}"

INTENTO STRUTTURATO:
- Segnali richiesti: {{SIGNALS}}
- Ruoli hiring: {{ROLES}}
- Settore/keywords: {{SECTORS}}
- Spiegazione: {{REASONING}}

AZIENDA (da Google Maps + audit sito):
{{LEAD_CONTEXT}}

COMPITO:
1. Raccogli e sintetizza TUTTE le evidenze utili per la richiesta dell'utente (assunzioni, fondi, gare, CRM, investimenti, tech stack, crescita).
2. Usa il contesto fornito: audit sito, worker (Indeed/ANAC/OpenAPI), ricerca web. Se manca un dato, cerca indizi nel testo disponibile — NON inventare numeri o fatti.
3. Arricchisci il lead: estrai fatti concreti (ruoli aperti, round di funding, gare, stack, pain point) e mettili in summary + evidence.
4. matches_request=true solo se c'è evidenza reale che l'azienda soddisfa la richiesta; altrimenti false con summary breve.

Rispondi SOLO JSON valido:
{
  "matches_request": true/false,
  "confidence": 0-100,
  "summary": "frase italiana con il dato trovato (max 140 caratteri)",
  "evidence": [{"label":"Fonte","value":"dettaglio","url":"opzionale"}],
  "enriched_fields": {"hiring_roles":[],"funding_hint":null,"crm_stack":[],"sector_signals":[],"notes":null}
}`

function enrichModel(): string {
  return (
    process.env.CLAUDE_ENRICH_MODEL ||
    process.env.SEMANTIC_MODEL ||
    'claude-sonnet-4-20250514'
  )
}

export async function enrichLeadWithClaude(
  lead: Record<string, unknown>,
  userQuery: string,
  intent: SignalIntentSpec,
): Promise<ClaudeLeadEnrichment | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !userQuery.trim()) return null

  const leadContext = await gatherLeadContext(lead, userQuery, intent)
  const prompt = ENRICH_PROMPT.replace('{{USER_QUERY}}', userQuery.trim())
    .replace('{{SIGNALS}}', intent.required_signals.join(', ') || 'nessuno')
    .replace('{{ROLES}}', intent.hiring_roles.join(', ') || '—')
    .replace('{{SECTORS}}', intent.sector_keywords.join(', ') || '—')
    .replace('{{REASONING}}', intent.reasoning || intent.intent_summary || '—')
    .replace('{{LEAD_CONTEXT}}', leadContext)

  const model = enrichModel()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  })

  if (!res.ok) {
    console.warn('[claude-enrich] HTTP', res.status)
    return null
  }

  const data = (await res.json()) as { content?: Array<{ text?: string }> }
  const text = data.content?.[0]?.text || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const summary = String(parsed.summary || '').trim()
    if (!summary) return null
    return {
      matches_request: parsed.matches_request === true,
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
      summary: summary.slice(0, 200),
      evidence: Array.isArray(parsed.evidence)
        ? parsed.evidence
            .filter((e) => e && typeof e === 'object')
            .map((e) => {
              const ev = e as Record<string, unknown>
              return {
                label: String(ev.label || 'Evidenza'),
                value: String(ev.value || ''),
                url: typeof ev.url === 'string' ? ev.url : undefined,
              }
            })
            .slice(0, 4)
        : [],
      checked_at: new Date().toISOString(),
      model,
    }
  } catch {
    return null
  }
}

const CONCURRENCY = 3

export async function enrichLeadsBatchWithClaude(
  leads: Record<string, unknown>[],
  userQuery: string,
  intent: SignalIntentSpec,
  maxLeads = 20,
): Promise<Record<string, unknown>[]> {
  const batch = leads.slice(0, maxLeads)
  const out: Record<string, unknown>[] = []

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(
      slice.map(async (lead) => {
        if (lead.claude_enrichment) return lead
        try {
          const enrichment = await enrichLeadWithClaude(lead, userQuery, intent)
          if (!enrichment) return lead
          return { ...lead, claude_enrichment: enrichment }
        } catch (e) {
          console.warn('[claude-enrich] lead skip', e)
          return lead
        }
      }),
    )
    out.push(...settled)
  }

  return out
}
