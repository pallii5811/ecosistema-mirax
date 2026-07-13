/**
 * AI SDR MVP — classificazione risposte email (suggest-only, HITL).
 * Rule-based fallback + OpenAI gpt-4o-mini (allineato al resto del codebase).
 */

export type ReplyIntent =
  | 'interested'
  | 'not_now'
  | 'not_interested'
  | 'wrong_person'
  | 'unsubscribe'
  | 'unknown'

export type ReplyClassification = {
  intent: ReplyIntent
  suggested_action: string
  follow_up_at: string | null
  confidence: number
  rationale: string
  model: string
}

export const REPLY_INTENT_META: Record<
  ReplyIntent,
  { label: string; tone: string; defaultAction: string; followUpDays: number | null }
> = {
  interested: {
    label: 'Interessato',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    defaultAction: 'Proponi una call di 15 minuti entro 48 ore con 2 slot orari concreti.',
    followUpDays: 2,
  },
  not_now: {
    label: 'Non ora',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    defaultAction: 'Ringrazia e programma un follow-up tra 2 settimane con un messaggio di valore (case study breve).',
    followUpDays: 14,
  },
  not_interested: {
    label: 'Non interessato',
    tone: 'border-rose-200 bg-rose-50 text-rose-800',
    defaultAction: 'Archivia il lead e non inviare ulteriori messaggi commerciali.',
    followUpDays: null,
  },
  wrong_person: {
    label: 'Persona sbagliata',
    tone: 'border-sky-200 bg-sky-50 text-sky-800',
    defaultAction: 'Chiedi gentilmente il referente corretto (nome + email/telefono) per marketing/acquisti.',
    followUpDays: 5,
  },
  unsubscribe: {
    label: 'Opt-out',
    tone: 'border-red-200 bg-red-50 text-red-800',
    defaultAction: 'Conferma la rimozione dalla lista e non contattare più questo indirizzo.',
    followUpDays: null,
  },
  unknown: {
    label: 'Da revisionare',
    tone: 'border-slate-200 bg-slate-50 text-slate-700',
    defaultAction: 'Revisione manuale: leggi la risposta e decidi il prossimo passo.',
    followUpDays: 3,
  },
}

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function buildResult(
  intent: ReplyIntent,
  confidence: number,
  rationale: string,
  model: string,
  suggested_action?: string,
): ReplyClassification {
  const meta = REPLY_INTENT_META[intent]
  return {
    intent,
    suggested_action: suggested_action?.trim() || meta.defaultAction,
    follow_up_at: meta.followUpDays !== null ? addDays(meta.followUpDays) : null,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    rationale,
    model,
  }
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Classificazione rule-based — usata in test e come fallback senza API key. */
export function classifyReplyRules(replySnippet: string): ReplyClassification | null {
  const t = normalize(replySnippet)
  if (!t.trim()) return null

  if (/\b(unsubscribe|opt.?out|rimuov|non contatt|stop email|cancell.*iscriz|gdpr|privacy.*rimuov)\b/.test(t)) {
    return buildResult('unsubscribe', 92, 'Richiesta esplicita di opt-out o rimozione.', 'rules-v1')
  }
  if (/\b(non sono|persona sbagliata|wrong person|non compet|referente|collega giusto|inoltro a)\b/.test(t)) {
    return buildResult('wrong_person', 85, 'Il mittente indica di non essere il referente corretto.', 'rules-v1')
  }
  if (/\b(non interess|no grazie|non mi interessa|lascia perdere|non proced|passo|declino)\b/.test(t)) {
    return buildResult('not_interested', 88, 'Rifiuto esplicito dell\'offerta.', 'rules-v1')
  }
  if (/\b(interessat|mandami|inviami|call|telefon|videochiam|appuntament|ok proced|perfetto parliam|quando possiamo)\b/.test(t)) {
    return buildResult('interested', 86, 'Segnali positivi o richiesta di approfondimento.', 'rules-v1')
  }
  if (/\b(piu tardi|più tardi|non ora|tra qualche|tra un mese|richiam|remind|mese prossim|quando avro|occupat)\b/.test(t)) {
    return buildResult('not_now', 80, 'Interesse differito o timing non adatto.', 'rules-v1')
  }
  return null
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, '').trim())
  } catch {
    return null
  }
}

const VALID_INTENTS = new Set<ReplyIntent>([
  'interested',
  'not_now',
  'not_interested',
  'wrong_person',
  'unsubscribe',
  'unknown',
])

export async function classifyReplyWithAI(
  replySnippet: string,
  context?: { leadName?: string; leadWebsite?: string; originalSubject?: string },
): Promise<ReplyClassification> {
  const trimmed = replySnippet.trim()
  if (!trimmed) {
    return buildResult('unknown', 30, 'Risposta vuota.', 'rules-v1')
  }

  const rules = classifyReplyRules(trimmed)
  if (rules && rules.confidence >= 85) return rules

  const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
  if (!apiKey) {
    return rules || buildResult('unknown', 45, 'Classificazione euristica — verifica manuale consigliata.', 'rules-v1')
  }

  const ctx = [
    context?.leadName ? `Lead: ${context.leadName}` : '',
    context?.leadWebsite ? `Sito: ${context.leadWebsite}` : '',
    context?.originalSubject ? `Oggetto originale: ${context.originalSubject}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `Sei un assistente SDR B2B per agenzie marketing italiane.
Classifica la RISPOSTA email del prospect. NON suggerire invii automatici — solo azione per l'operatore umano.

${ctx ? `Contesto:\n${ctx}\n` : ''}
Risposta del prospect:
"""
${trimmed.slice(0, 2000)}
"""

Rispondi SOLO con JSON valido:
{
  "intent": "interested" | "not_now" | "not_interested" | "wrong_person" | "unsubscribe" | "unknown",
  "suggested_action": "stringa in italiano, max 200 caratteri, azione concreta per l'operatore",
  "follow_up_days": number | null,
  "confidence": 0-100,
  "rationale": "breve spiegazione in italiano"
}`

  try {
    const res = await fetch('data:,mirax-legacy-provider-removed', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Classificatore SDR MIRAX. Output JSON strict. Human-in-the-loop sempre.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!res.ok) {
      return rules || buildResult('unknown', 40, `AI non disponibile (${res.status}).`, 'rules-v1')
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content || ''
    const parsed = safeJsonParse(raw) as Record<string, unknown> | null
    if (!parsed) {
      return rules || buildResult('unknown', 40, 'Parsing AI fallito.', 'gpt-4o-mini')
    }

    const intentRaw = String(parsed.intent || 'unknown')
    const intent = VALID_INTENTS.has(intentRaw as ReplyIntent) ? (intentRaw as ReplyIntent) : 'unknown'
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 70
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : 'Classificazione AI.'
    const suggested =
      typeof parsed.suggested_action === 'string' ? parsed.suggested_action : REPLY_INTENT_META[intent].defaultAction

    let follow_up_at: string | null = null
    if (typeof parsed.follow_up_days === 'number' && parsed.follow_up_days > 0) {
      follow_up_at = addDays(Math.round(parsed.follow_up_days))
    } else if (REPLY_INTENT_META[intent].followUpDays !== null) {
      follow_up_at = addDays(REPLY_INTENT_META[intent].followUpDays!)
    }

    return {
      intent,
      suggested_action: suggested.slice(0, 400),
      follow_up_at,
      confidence: Math.max(0, Math.min(100, Math.round(confidence))),
      rationale: rationale.slice(0, 400),
      model: 'gpt-4o-mini',
    }
  } catch {
    return rules || buildResult('unknown', 40, 'Errore rete AI.', 'rules-v1')
  }
}

/** Mappa intent → status outreach_log per chiusura funnel. */
export function intentToOutreachStatus(intent: ReplyIntent): string {
  if (intent === 'interested') return 'interested'
  if (intent === 'not_interested' || intent === 'unsubscribe') return 'not_interested'
  if (intent === 'not_now' || intent === 'wrong_person') return 'replied'
  return 'replied'
}
