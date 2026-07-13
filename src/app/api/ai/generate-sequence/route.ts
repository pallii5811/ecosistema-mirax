import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

type EmailStep = {
  step: number
  subject: string
  body: string
  waitDays: number
}

function buildFallbackSequence(input: {
  companyName: string
  website: string
  service: string
  senderName: string
  senderCompany: string
  tone: string
  stepsCount: number
}): EmailStep[] {
  const company = input.companyName.trim()
  const service = input.service.trim() || 'acquisizione clienti e presenza digitale'
  const sender = input.senderName.trim() || input.senderCompany.trim() || 'il nostro team'
  const sign = input.senderCompany.trim() || sender
  const websiteLine = input.website.trim() ? ` Ho visto anche il sito ${input.website.trim()} e credo ci siano margini interessanti da valorizzare.` : ''
  const formal = input.tone === 'professionale' || input.tone === 'consulenziale'
  const greeting = formal ? 'Buongiorno' : 'Ciao'

  const templates: Omit<EmailStep, 'step'>[] = [
    {
      waitDays: 0,
      subject: `Spunto concreto per ${company}`,
      body: `${greeting},\n\nle scrivo perché ${company} sembra un profilo interessante per un lavoro mirato su ${service}.${websiteLine}\n\nL’obiettivo sarebbe semplice: individuare 2-3 leve rapide per generare più contatti qualificati senza disperdere budget.\n\nHa senso fissare una call di 15 minuti questa settimana?\n\nUn saluto,\n${sender}`,
    },
    {
      waitDays: 3,
      subject: `Idea rapida su ${company}`,
      body: `${greeting},\n\nmi ricollego alla mail precedente. Di solito vediamo che aziende come ${company} possono migliorare risultati commerciali lavorando su tre aree: target giusto, messaggio più specifico e follow-up costante.\n\nPosso mandarvi una mini-analisi con le opportunità più evidenti per ${service}?\n\nUn saluto,\n${sender}`,
    },
    {
      waitDays: 7,
      subject: `Priorità commerciali per i prossimi 30 giorni`,
      body: `${greeting},\n\nse in questo periodo state cercando di aumentare richieste, appuntamenti o pipeline, posso aiutarvi a capire quali canali e messaggi hanno più probabilità di funzionare per ${company}.\n\nLa proposta è partire da una diagnosi breve e concreta, senza impegno.\n\nPreferite sentirci domani mattina o nel pomeriggio?\n\n${sign}`,
    },
    {
      waitDays: 12,
      subject: `Chiudo il cerchio`,
      body: `${greeting},\n\nnon voglio insistere se non è una priorità. Le lascio però uno spunto: spesso il problema non è “fare più marketing”, ma trovare aziende già in target e contattarle con un motivo forte e verificabile.\n\nSe vuole, preparo una bozza di piano operativo per ${company}.\n\nUn saluto,\n${sender}`,
    },
    {
      waitDays: 18,
      subject: `Ultimo messaggio su ${company}`,
      body: `${greeting},\n\nultimo messaggio da parte mia. Se ${service} non è tra le vostre priorità ora, nessun problema.\n\nSe invece volete capire dove ci sono opportunità rapide, posso inviarvi 3 azioni pratiche da valutare.\n\nGrazie,\n${sender}`,
    },
    {
      waitDays: 25,
      subject: `Riapro solo se utile`,
      body: `${greeting},\n\nla contatto un’ultima volta con un approccio molto pratico: posso analizzare ${company} e dirvi dove vedo il miglior potenziale di crescita commerciale nei prossimi 30 giorni.\n\nSe può essere utile, mi basta un ok e preparo il materiale.\n\n${sign}`,
    },
  ]

  return templates.slice(0, input.stepsCount).map((email, index) => ({
    step: index + 1,
    subject: email.subject,
    body: email.body,
    waitDays: email.waitDays,
  }))
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

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
  const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
  if (!apiKey) {
    return NextResponse.json({
      sequence: buildFallbackSequence({ companyName, website, service, senderName, senderCompany, tone, stepsCount }),
      fallback: true,
    })
  }

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

    const res = await fetch('data:,mirax-legacy-provider-removed', {
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
