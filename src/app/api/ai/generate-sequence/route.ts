import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API key non configurata' }, { status: 500 })

  const body = await req.json()
  const {
    companyName = '',
    website = '',
    service = '',
    senderName = '',
    senderCompany = '',
    tone = 'professionale',
    language = 'italiano',
    steps = 4,
  } = body

  if (!companyName) return NextResponse.json({ error: 'Nome azienda obbligatorio' }, { status: 400 })

  const stepsCount = Math.min(Math.max(2, Number(steps) || 4), 6)

  const systemPrompt = `Sei un esperto copywriter B2B italiano specializzato in cold email outreach per agenzie di marketing digitale e vendita servizi.

Genera una sequenza di ${stepsCount} email di outreach in ${language}, tono ${tone}.

Regole IMPORTANTI:
- Ogni email deve avere: subject (oggetto), body (corpo completo), waitDays (giorni di attesa prima di inviare, 0 per la prima)
- Email 1: Primo contatto - breve, personalizzata, incuriosisce
- Email 2: Follow-up - aggiunge valore, menziona un problema specifico
- Email 3: Social proof / case study - mostra risultati concreti
- Email 4+: Urgenza / ultima chance - offerta limitata o recap
- MASSIMO 120 parole per email
- Usa il "tu" o il "Lei" in base al tono
- Includi una CTA chiara in ogni email
- NON usare placeholder tipo [Nome] — scrivi testo pronto all'uso
- Se il servizio non è specificato, deduci dal contesto

Rispondi SOLO con un JSON array valido: [{"subject":"...","body":"...","waitDays":0},...]`

  const userPrompt = `Azienda target: ${companyName}
${website ? `Sito web: ${website}` : ''}
${service ? `Servizio da vendere: ${service}` : 'Servizio: marketing digitale / gestione social / ads'}
${senderName ? `Mittente: ${senderName}` : ''}
${senderCompany ? `Azienda mittente: ${senderCompany}` : ''}
Tono: ${tone}
Numero email nella sequenza: ${stepsCount}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (!res.ok) {
      const err = await res.text().catch(() => 'OpenAI error')
      console.error('OpenAI error:', err)
      return NextResponse.json({ error: 'Errore nella generazione AI' }, { status: 502 })
    }

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content || ''

    let sequence: any[] = []
    try {
      const parsed = JSON.parse(raw)
      sequence = Array.isArray(parsed) ? parsed : Array.isArray(parsed.sequence) ? parsed.sequence : Array.isArray(parsed.emails) ? parsed.emails : []
    } catch {
      console.error('Failed to parse sequence:', raw)
      return NextResponse.json({ error: 'Formato risposta AI non valido' }, { status: 502 })
    }

    const cleaned = sequence.map((email: any, i: number) => ({
      step: i + 1,
      subject: typeof email.subject === 'string' ? email.subject : `Email ${i + 1}`,
      body: typeof email.body === 'string' ? email.body : '',
      waitDays: typeof email.waitDays === 'number' ? email.waitDays : i === 0 ? 0 : i * 3,
    }))

    return NextResponse.json({ sequence: cleaned })
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return NextResponse.json({ error: 'Timeout nella generazione. Riprova.' }, { status: 504 })
    }
    console.error('Sequence generation error:', err)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
