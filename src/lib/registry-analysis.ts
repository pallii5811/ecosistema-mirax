import 'server-only'

type RegistryAnalysis = {
  foundedYear: number | null
  legalForm: string | null
  employees: string | null
  revenue: string | null
  insights: string[]
}

function safeJsonParse(raw: string): any {
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, '').trim())
  } catch {
    return null
  }
}

function sanitizeRegistryAnalysis(parsed: any): RegistryAnalysis {
  const foundedYear = typeof parsed?.foundedYear === 'number' && Number.isFinite(parsed.foundedYear) ? parsed.foundedYear : null

  const legalForm = typeof parsed?.legalForm === 'string' && parsed.legalForm.trim() ? parsed.legalForm.trim() : null

  const employees = typeof parsed?.employees === 'string' && parsed.employees.trim() ? parsed.employees.trim() : null

  const revenue = typeof parsed?.revenue === 'string' && parsed.revenue.trim() ? parsed.revenue.trim() : null

  const insights = Array.isArray(parsed?.insights) ? parsed.insights.filter((x: any) => typeof x === 'string') : []

  return {
    foundedYear,
    legalForm,
    employees,
    revenue,
    insights,
  }
}

export async function analyzeRegistry(name: string, city: string, category: string): Promise<RegistryAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      foundedYear: null,
      legalForm: null,
      employees: null,
      revenue: null,
      insights: [],
    }
  }

  const businessName = String(name || '').trim()
  const c = String(city || '').trim()
  const cat = String(category || '').trim()

  if (!businessName || !c) {
    return {
      foundedYear: null,
      legalForm: null,
      employees: null,
      revenue: null,
      insights: [],
    }
  }

  const prompt = `Sei un consulente commerciale B2B.

Devi creare un profilo aziendale sintetico per un lead italiano, basandoti SOLO su conoscenza generale e ragionamento.
Non inventare dati specifici come se fossero verificati: se non sei sicuro, usa null o stime qualitative.

Lead:
Nome: ${businessName}
Città: ${c}
Settore: ${cat || 'non specificato'}

Rispondi SOLO con JSON valido:
{
  "foundedYear": numero_o_null,
  "legalForm": "stringa_o_null",
  "employees": "es. 1-5 | 6-10 | 11-50 | 51-200 | 200+ | null",
  "revenue": "es. <500k | 500k-2M | 2M-10M | 10M+ | null",
  "insights": [
    "punto rilevante 1",
    "punto rilevante 2",
    "punto rilevante 3"
  ]
}
Solo JSON.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.1,
      }),
    })

    const data = (await res.json()) as any
    const content = data?.choices?.[0]?.message?.content || '{}'
    const parsed = safeJsonParse(String(content))

    if (!parsed) {
      return {
        foundedYear: null,
        legalForm: null,
        employees: null,
        revenue: null,
        insights: [],
      }
    }

    return sanitizeRegistryAnalysis(parsed)
  } catch (e) {
    console.error('[REGISTRY]', e)
    return {
      foundedYear: null,
      legalForm: null,
      employees: null,
      revenue: null,
      insights: [],
    }
  }
}
