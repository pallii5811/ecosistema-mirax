/**
 * Fase 9.2 — AI copywriter outbound (3 varianti A/B/C, manifesto prompt).
 */

export type OutboundCopyVariant = {
  label: 'A' | 'B' | 'C'
  subject: string
  body: string
}

export type OutboundCopyInput = {
  personaName?: string
  companyName: string
  tone?: 'formale' | 'casual' | 'professionale'
  signals: Array<{ type: string; title: string; reason?: string }>
  templateKey?: string
}

export const OUTBOUND_COPYWRITER_SYSTEM = `Sei un copywriter B2B italiano. Scrivi email di prospezione personalizzate.
Regole:
- Max 120 parole per variante
- Un solo CTA
- Tono professionale ma non freddo
- Menziona UN SOLO segnale come gancio (il più forte)
- Oggetto: curiosità + rilevanza
- NON inventare dati di contatto o fatti non forniti

Restituisci SOLO JSON:
{
  "variants": [
    { "label": "A", "subject": "...", "body": "..." },
    { "label": "B", "subject": "...", "body": "..." },
    { "label": "C", "subject": "...", "body": "..." }
  ]
}`

export function buildOutboundCopyPrompt(input: OutboundCopyInput): string {
  const tone = input.tone || 'professionale'
  const persona = input.personaName?.trim() || 'referente marketing/acquisti'
  const signalBlock = input.signals
    .slice(0, 4)
    .map((s) => `- [${s.type}] ${s.title}${s.reason ? ` — ${s.reason}` : ''}`)
    .join('\n')

  return `Scrivi 3 varianti email per ${persona} di ${input.companyName}.
Tono: ${tone}
Template play: ${input.templateKey || 'signal_outreach'}

Segnali d'acquisto (usa il più forte come gancio):
${signalBlock || '- Nessun segnale strutturato — tono esplorativo conservativo'}`
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, '').trim())
  } catch {
    return null
  }
}

export function parseCopywriterResponse(raw: string): OutboundCopyVariant[] {
  const parsed = safeJsonParse(raw) as { variants?: unknown[] } | null
  const list = Array.isArray(parsed?.variants) ? parsed!.variants! : []
  const out: OutboundCopyVariant[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const label = String(r.label || '').toUpperCase()
    if (label !== 'A' && label !== 'B' && label !== 'C') continue
    const subject = typeof r.subject === 'string' ? r.subject.trim() : ''
    const body = typeof r.body === 'string' ? r.body.trim() : ''
    if (!subject || !body) continue
    out.push({ label, subject: subject.slice(0, 200), body: body.slice(0, 2000) })
  }
  return out.slice(0, 3)
}

export async function generateOutboundVariants(input: OutboundCopyInput): Promise<{
  variants: OutboundCopyVariant[]
  model: string
}> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    const hook = input.signals[0]?.title || 'la vostra attività'
    return {
      model: 'fallback-v1',
      variants: [
        {
          label: 'A',
          subject: `Idea per ${input.companyName}`,
          body: `Buongiorno,\n\nho notato ${hook} e penso possiamo aiutarvi con risultati misurabili.\n\nAvete 15 minuti questa settimana per una call?\n\nCordiali saluti`,
        },
      ],
    }
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.65,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: OUTBOUND_COPYWRITER_SYSTEM },
        { role: 'user', content: buildOutboundCopyPrompt(input) },
      ],
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}`)
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content || ''
  const variants = parseCopywriterResponse(raw)
  if (variants.length === 0) {
    throw new Error('Nessuna variante generata')
  }
  return { variants, model: 'gpt-4o-mini' }
}
