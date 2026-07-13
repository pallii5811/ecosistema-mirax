import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://116.203.137.39:8002'
const OPENAPI_IT_TOKEN = process.env.OPENAPI_IT_TOKEN || ''

// ── Helpers ──────────────────────────────────────────────────────

function extractFormaGiuridica(name: string): string | null {
  const n = name.toLowerCase()
  if (/\bs\.?r\.?l\.?s?\b/.test(n) || n.includes('srls')) return n.includes('srls') ? 'SRLS' : 'SRL'
  if (/\bs\.?p\.?a\.?\b/.test(n)) return 'SPA'
  if (/\bs\.?n\.?c\.?\b/.test(n)) return 'SNC'
  if (/\bs\.?a\.?s\.?\b/.test(n)) return 'SAS'
  if (/\bs\.?s\.?\b/.test(n) && !n.includes('ss.')) return 'SS'
  return null
}

const PIVA_RE = [
  /(?:P\.?\s*I\.?V\.?A\.?|Partita\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I\.?V\.?A\.?)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /\bIT(\d{11})\b/g,
]

function extractPivaFromHtml(html: string): string | null {
  for (const re of PIVA_RE) {
    re.lastIndex = 0
    const m = re.exec(html)
    if (m?.[1]) return m[1]
  }
  const area = html.match(/(?:P\.?\s*I\.?V\.?A|Partita\s*IVA|codice\s*fiscale).{0,100}/gi)
  if (area) {
    for (const a of area) {
      const d = a.match(/\b(\d{11})\b/)
      if (d?.[1]) return d[1]
    }
  }
  return null
}

async function fetchHtmlSafe(url: string, ms = 5000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(ms),
      redirect: 'follow',
    })
    return await res.text()
  } catch { return '' }
}

// ── VIES: official EU P.IVA verification ─────────────────────────
async function verifyPivaVies(piva: string): Promise<{
  valid: boolean; name?: string; address?: string
} | null> {
  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/${piva}`,
      { signal: AbortSignal.timeout(6000) }
    )
    const d = (await res.json()) as any
    if (d?.isValid) {
      return {
        valid: true,
        name: typeof d.name === 'string' && d.name !== '---' ? d.name.trim() : undefined,
        address: typeof d.address === 'string' && d.address !== '---' ? d.address.trim() : undefined,
      }
    }
    return { valid: false }
  } catch { return null }
}

// ── CompanyReports.it: FREE real company data (fatturato, dipendenti) ──
async function scrapeCompanyReports(piva: string): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`https://www.companyreports.it/${piva}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    if (html.length < 5000) return null // not a company page
    // Detect homepage (company not found → redirects to homepage)
    if (html.includes('<title>CompanyReports - Il fatturato')) return null

    const result: Record<string, string> = {}

    // Meta description: "Company Fatturato 2.630.757.873, Partita Iva: ..., Cod. Ateco 10.73"
    const meta = html.match(/meta name="description" content="([^"]+)"/i)
    if (meta) {
      const desc = meta[1]
      const fatM = desc.match(/Fatturato\s+([\d.,]+)/i)
      if (fatM) result.fatturato = fatM[1].replace(/,+$/, '').trim()
      const ateM = desc.match(/Ateco\s+([\d.]+)/i)
      if (ateM) result.codice_ateco = ateM[1].replace(/\.+$/, '').trim()
    }

    // JSON-LD FAQ structured data (has dipendenti, sede legale, costo personale)
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
    for (const block of jsonLdBlocks) {
      try {
        const d = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim()) as any
        const items = d.mainEntity || []
        for (const item of items) {
          const q = (item.name || '').toLowerCase()
          const a: string = item.acceptedAnswer?.text || ''
          if (q.includes('fatturato') && !result.fatturato) {
            const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
            if (m) result.fatturato = m[1].replace(/,+$/, '').trim()
            const y = a.match(/\((\d{4})\)/)
            if (y) result.fatturato_anno = y[1]
          }
          if (q.includes('dipendenti')) {
            const m = a.match(/da\s*(\d+)\s*a\s*(\d+)/i)
            if (m) result.dipendenti = `${m[1]}-${m[2]}`
            else {
              const m2 = a.match(/(\d+)\s*dipendenti/i) || a.match(/pari a\s*(\d+)/i)
              if (m2) result.dipendenti = m2[1]
            }
          }
          if (q.includes('ateco') && !result.descrizione_ateco) {
            const m = a.match(/codice ATECO\s*[\d.]+\s*[-–—]\s*(.+?)(?:\.|$)/i)
            if (m) result.descrizione_ateco = m[1].trim()
          }
          if (q.includes('sede legale') && !result.sede_legale) {
            const m = a.match(/è\s+(.+?)(?:\.$|$)/i)
            if (m) result.sede_legale = m[1].trim()
          }
          if (q.includes('costo del personale')) {
            const m = a.match(/pari a\s+€?\s*([\d.,]+)/i) || a.match(/€\s*([\d.,]+)/)
            if (m) result.costo_personale = m[1].replace(/,+$/, '').trim()
          }
        }
      } catch { /* ignore malformed JSON-LD */ }
    }

    // HTML table: Stato Attività, Forma Giuridica, N. Dipendenti
    const statoM = html.match(/Stato Attivit[àa]<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (statoM) result.stato = statoM[1].trim()
    const formaM = html.match(/Forma Giuridica<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
    if (formaM) result.forma_giuridica = formaM[1].trim()
    // Dipendenti from HTML table if not from JSON-LD
    if (!result.dipendenti) {
      const dipM = html.match(/N\.?\s*Dipendenti<\/b><\/p><\/div>\s*<div[^>]*><p>([^<]+)/i)
      if (dipM) result.dipendenti = dipM[1].trim()
    }

    // Ragione sociale from title
    const titleM = html.match(/<title>([^(<]+)/i)
    if (titleM) result.ragione_sociale = titleM[1].replace(/\s*Fatturato.*$/i, '').trim()

    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── OpenAPI.it IT-advanced: PAID real data from Camera di Commercio ──
interface OpenApiCompany {
  companyName?: string
  vatCode?: string
  address?: {
    registeredOffice?: {
      streetName?: string
      town?: string
      province?: string
      zipCode?: string
    }
  }
  activityStatus?: string
  reaCode?: string
  cciaa?: string
  atecoClassification?: {
    ateco2007?: { code?: string; description?: string }
  }
  detailedLegalForm?: { description?: string }
  startDate?: string
  pec?: string
  balanceSheets?: {
    last?: {
      year?: number
      employees?: number
      turnover?: number
      shareCapital?: number
      totalStaffCost?: number
    }
  }
}

async function fetchOpenApiIt(piva: string): Promise<Record<string, any> | null> {
  if (!OPENAPI_IT_TOKEN) return null
  try {
    const res = await fetch(`https://company.openapi.com/IT-advanced/${piva}`, {
      headers: {
        Authorization: `Bearer ${OPENAPI_IT_TOKEN}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as any
    if (!json?.success || !json?.data?.[0]) return null
    const c: OpenApiCompany = json.data[0]

    const result: Record<string, any> = {}
    if (c.companyName) result.ragione_sociale = c.companyName
    if (c.vatCode) result.partita_iva = c.vatCode

    // Sede legale
    const off = c.address?.registeredOffice
    if (off?.streetName) {
      result.sede_legale = [off.streetName, off.zipCode, off.town, off.province]
        .filter(Boolean).join(', ')
    }

    // ATECO
    const ateco = c.atecoClassification?.ateco2007
    if (ateco?.code) {
      result.codice_ateco = ateco.code
      if (ateco.description) result.descrizione_ateco = ateco.description
    }

    // Forma giuridica
    if (c.detailedLegalForm?.description) result.forma_giuridica = c.detailedLegalForm.description

    // Stato
    if (c.activityStatus) result.stato = c.activityStatus === 'ATTIVA' ? 'Attiva' : c.activityStatus

    // REA
    if (c.reaCode && c.cciaa) result.codice_rea = `${c.cciaa} ${c.reaCode}`

    // PEC
    if (c.pec) result.pec = c.pec

    // Data costituzione
    if (c.startDate) result.data_costituzione = c.startDate

    // Bilancio (fatturato, dipendenti, capitale)
    const bs = c.balanceSheets?.last
    if (bs) {
      if (bs.turnover) {
        result.fatturato = new Intl.NumberFormat('it-IT').format(bs.turnover)
        result.fatturato_anno = String(bs.year || '')
        result.fatturato_fonte = 'registro_imprese'
      }
      if (bs.employees) {
        result.dipendenti = String(bs.employees)
        result.dipendenti_fonte = 'registro_imprese'
      }
      if (bs.shareCapital) {
        result.capitale_sociale = '€ ' + new Intl.NumberFormat('it-IT').format(bs.shareCapital)
      }
      if (bs.totalStaffCost) {
        result.costo_personale = new Intl.NumberFormat('it-IT').format(bs.totalStaffCost)
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch { return null }
}

// ── Main route ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { lead } = body

  const business_name = lead?.nome || lead?.azienda || lead?.business_name || ''
  const city = lead?.citta || lead?.city || ''
  const address = lead?.indirizzo || lead?.address || lead?.via || ''
  const category = lead?.categoria || lead?.category || ''
  const website = lead?.sito || lead?.website || ''

  if (!business_name) {
    return NextResponse.json({ found: false })
  }

  // ─── Step 1: Try backend for REAL Registro Imprese data ────────
  try {
    const res = await fetch(`${BACKEND_URL}/scrape-registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name, city, website }),
      signal: AbortSignal.timeout(25000),
    })
    const data = (await res.json()) as any

    if (data?.found === true) {
      if (!data.sede_legale && address) data.sede_legale = address
      data.fonte = 'registro_imprese'
      return NextResponse.json(data)
    }
  } catch {
    // Backend non disponibile, continua
  }

  // ─── Step 2: Extract P.IVA from company website ───────────────
  let websitePiva: string | null = null
  if (website) {
    const baseUrl = website.startsWith('http') ? website : `https://${website}`
    const origin = (() => { try { return new URL(baseUrl).origin } catch { return baseUrl } })()
    const mainHtml = await fetchHtmlSafe(baseUrl, 6000)
    websitePiva = extractPivaFromHtml(mainHtml)
    if (!websitePiva) {
      const pages = ['/contatti', '/contacts', '/privacy', '/privacy-policy', '/chi-siamo']
      const fetches = await Promise.allSettled(pages.slice(0, 3).map(p => fetchHtmlSafe(`${origin}${p}`, 4000)))
      for (const r of fetches) {
        if (r.status === 'fulfilled' && r.value) {
          const found = extractPivaFromHtml(r.value)
          if (found) { websitePiva = found; break }
        }
      }
    }
  }

  // ─── Step 3: VIES verification (official EU registry) ─────────
  let viesData: { valid: boolean; name?: string; address?: string } | null = null
  if (websitePiva) {
    viesData = await verifyPivaVies(websitePiva)
  }

  // ─── Step 4: Scrape companyreports.it for REAL data (gratis) ───
  let crData: Record<string, string> | null = null
  if (websitePiva) {
    crData = await scrapeCompanyReports(websitePiva)
  }

  // ─── Step 4b: OpenAPI.it fallback (PAID, finds all SRL/SPA) ────
  let oaData: Record<string, any> | null = null
  if (websitePiva && (!crData?.fatturato || !crData?.codice_ateco)) {
    oaData = await fetchOpenApiIt(websitePiva)
  }

  // ─── Step 5: Build profile from REAL verified sources ─────────
  const formaFromName = extractFormaGiuridica(business_name)

  const profile: Record<string, any> = {
    found: true,
    fonte: 'google_maps',
  }

  // Merge: companyreports (free) > OpenAPI.it (paid) > VIES > name extraction
  const src = { ...oaData, ...crData } as Record<string, any> // crData wins where both exist

  // Ragione sociale
  profile.ragione_sociale = src.ragione_sociale || viesData?.name || business_name

  // Sede legale
  if (src.sede_legale) {
    profile.sede_legale = src.sede_legale
  } else if (viesData?.address) {
    profile.sede_legale = viesData.address
    profile.sede_legale_verificata = true
  } else if (address) {
    profile.sede_legale = address
  }

  // P.IVA from website (REAL)
  if (websitePiva) {
    profile.partita_iva = websitePiva
    if (viesData?.valid) {
      profile.piva_verificata = true
      profile.fonte = 'vies_verificato'
    }
  }

  // Forma giuridica: merged sources > name extraction
  if (src.forma_giuridica) {
    profile.forma_giuridica = src.forma_giuridica
  } else if (formaFromName) {
    profile.forma_giuridica = formaFromName
  }

  // REAL fatturato & dipendenti
  if (src.fatturato) {
    profile.fatturato = src.fatturato
    if (src.fatturato_anno) profile.fatturato_anno = src.fatturato_anno
    profile.fatturato_fonte = src.fatturato_fonte || 'registro_imprese'
  }
  if (src.dipendenti) {
    profile.dipendenti = src.dipendenti
    profile.dipendenti_fonte = src.dipendenti_fonte || 'registro_imprese'
  }
  if (src.costo_personale) profile.costo_personale = src.costo_personale
  if (src.capitale_sociale) profile.capitale_sociale = src.capitale_sociale

  // ATECO (REAL)
  if (src.codice_ateco) {
    profile.codice_ateco = src.codice_ateco
    if (src.descrizione_ateco) profile.descrizione_ateco = src.descrizione_ateco
    profile.fonte = 'registro_imprese'
  }

  // Extra fields from OpenAPI.it
  if (src.codice_rea) profile.codice_rea = src.codice_rea
  if (src.pec) profile.pec = src.pec
  if (src.data_costituzione) profile.data_costituzione = src.data_costituzione

  profile.stato = src.stato || 'Attiva'

  // ─── Step 6: GPT ONLY for ATECO if not found from real sources
  if (!profile.codice_ateco) {
    const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
    if (apiKey && category) {
      try {
        const prompt = `Basandoti ESCLUSIVAMENTE sulla categoria attività commerciale "${category}", qual è il codice ATECO più appropriato?
${!formaFromName ? `Stima anche la forma giuridica più probabile per "${business_name}".` : ''}
Rispondi SOLO con JSON: {"codice_ateco":"XX.XX.XX","descrizione_ateco":"descrizione"${!formaFromName ? ',"forma_giuridica":"..."' : ''}}`

        const res = await fetch('data:,mirax-legacy-provider-removed', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(8000),
        })

        const data = (await res.json()) as any
        const content = data?.choices?.[0]?.message?.content || '{}'
        const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

        if (parsed.codice_ateco) {
          profile.codice_ateco = parsed.codice_ateco
          if (parsed.descrizione_ateco) profile.descrizione_ateco = parsed.descrizione_ateco
          profile.ateco_stimato = true
        }
        if (!formaFromName && !profile.forma_giuridica && parsed.forma_giuridica) {
          profile.forma_giuridica = parsed.forma_giuridica
        }
      } catch {
        // GPT non disponibile
      }
    }
  }

  // Rimuovi campi null/vuoti
  for (const key of Object.keys(profile)) {
    if (profile[key] === null || profile[key] === '') delete profile[key]
  }

  return NextResponse.json(profile)
}
