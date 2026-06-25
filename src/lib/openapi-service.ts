import { createServiceRoleClient } from '@/utils/supabase/server'

type OpenApiSource = 'openapi_it_search' | 'openapi_it_advanced'

export interface OpenApiResult<T> {
  success: boolean
  data: T | null
  source: OpenApiSource
  fromCache: boolean
  skipped?: 'no_token' | 'mode_off' | 'wallet_low'
  errorMessage?: string
  costEur?: number
}

export interface OpenApiSearchHit {
  ragione_sociale: string
  partita_iva: string
  citta?: string
  provincia?: string
  indirizzo?: string
  forma_giuridica?: string
  pec?: string
  stato_attivita?: string
}

export interface OpenApiAdvancedData {
  ragione_sociale?: string
  partita_iva?: string
  codice_fiscale?: string
  sede_legale?: string
  indirizzo_via?: string
  indirizzo_numero_civico?: string
  citta?: string
  provincia?: string
  cap?: string
  regione?: string
  gps_lat?: number
  gps_lng?: number
  stato_attivita?: string
  codice_ateco?: string
  descrizione_ateco?: string
  forma_giuridica?: string
  forma_giuridica_codice?: string
  codice_rea?: string
  cciaa?: string
  pec?: string
  data_registrazione?: string
  data_costituzione?: string
  data_cessazione?: string
  codice_sdi?: string
  capitale_sociale?: number
  fatturato?: number
  fatturato_anno?: number
  dipendenti?: number
  costo_personale?: number
  patrimonio_netto?: number
  utile_netto?: number
  totale_attivo?: number
  ral_medio?: number
  storico_bilanci?: Array<{
    anno: number
    fatturato?: number
    utile?: number
    dipendenti?: number
    capitale_sociale?: number
    costo_personale?: number
    patrimonio_netto?: number
    totale_attivo?: number
  }>
  telefono?: string
  sito_web?: string
  shareholders?: Array<{
    nome: string
    cognome: string
    ragione_sociale_socio?: string
    taxCode?: string
    percentShare?: number
    isCompany?: boolean
  }>
  openapi_id?: string
  timestamp_creazione?: number
  timestamp_aggiornamento?: number
}

export interface OpenApiEnrichedCompany extends OpenApiAdvancedData {
  titolare_best?: {
    nome: string
    cognome: string
    nomeCompleto: string
    ruolo: string
    taxCode?: string
    source: 'shareholders'
  }
  cost_incurred_eur: number
  cached_hits: number
  live_calls: number
}

const OPENAPI_IT_TOKEN = process.env.OPENAPI_IT_TOKEN || ''
const OPENAPI_MODE = (process.env.OPENAPI_MODE || 'primary').toLowerCase()
const MIN_WALLET_EUR = Number(process.env.OPENAPI_MIN_WALLET_EUR || '2')
const CACHE_DAYS_ADVANCED = Number(process.env.OPENAPI_CACHE_DAYS_ADVANCED || '180')
const CACHE_DAYS_SEARCH = Number(process.env.OPENAPI_CACHE_DAYS_SEARCH || '30')

const memoryCache = new Map<string, { payload: unknown; expiresAt: number }>()
const inFlight = new Map<string, Promise<unknown>>()
let walletCache: { balanceEur: number; checkedAt: number } | null = null

function enabled() {
  return OPENAPI_MODE !== 'off' && Boolean(OPENAPI_IT_TOKEN)
}

export function cleanPiva(raw: string) {
  return String(raw || '').replace(/^IT/i, '').replace(/\D/g, '').trim()
}

async function withInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>
  const promise = fn().finally(() => inFlight.delete(key))
  inFlight.set(key, promise as Promise<unknown>)
  return promise
}

async function readCache<T>(piva: string, source: OpenApiSource): Promise<T | null> {
  const key = `${source}:${piva}`
  const hit = memoryCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.payload as T
  try {
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('company_lookup_cache')
      .select('payload, expires_at')
      .eq('piva', piva)
      .eq('source', source)
      .maybeSingle()
    if (error || !data) return null
    const expiresAt = new Date(data.expires_at).getTime()
    if (expiresAt < Date.now()) return null
    memoryCache.set(key, { payload: data.payload, expiresAt })
    return data.payload as T
  } catch {
    return null
  }
}

async function writeCache(piva: string, source: OpenApiSource, payload: unknown, ttlDays: number, ragioneSociale?: string) {
  const fetched = new Date()
  const expires = new Date(fetched.getTime() + ttlDays * 24 * 60 * 60 * 1000)
  memoryCache.set(`${source}:${piva}`, { payload, expiresAt: expires.getTime() })
  try {
    const sb = createServiceRoleClient()
    await sb.from('company_lookup_cache').upsert({
      piva,
      source,
      payload,
      ragione_sociale: ragioneSociale || null,
      fetched_at: fetched.toISOString(),
      expires_at: expires.toISOString(),
    }, { onConflict: 'piva,source' })
  } catch {}
}

async function walletAllows() {
  if (MIN_WALLET_EUR <= 0) return true
  if (!OPENAPI_IT_TOKEN) return false
  const now = Date.now()
  if (walletCache && now - walletCache.checkedAt < 60_000) return walletCache.balanceEur >= MIN_WALLET_EUR
  try {
    const res = await fetch('https://account.openapi.com/wallet/balance', {
      headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return true
    const json = await res.json()
    const balance = Number(json?.data?.balance ?? json?.balance ?? json?.data?.wallet ?? json?.data?.credit ?? NaN)
    if (!Number.isFinite(balance)) return true
    walletCache = { balanceEur: balance, checkedAt: now }
    return balance >= MIN_WALLET_EUR
  } catch {
    return true
  }
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!/^-?[\d.,\s]+$/.test(s)) return undefined
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.').replace(/\s/g, '') : s.replace(/,/g, '').replace(/\s/g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : undefined
}

function firstNestedNumber(v: unknown): number | undefined {
  const direct = toNumber(v)
  if (direct !== undefined) return direct
  if (Array.isArray(v)) {
    for (const item of v) {
      const n = firstNestedNumber(item)
      if (n !== undefined) return n
    }
    return undefined
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    for (const key of ['value', 'amount', 'current', 'total', 'result', 'items', 'values', 'rows', 'data', 'children']) {
      const n = firstNestedNumber(obj[key])
      if (n !== undefined) return n
    }
    for (const [key, value] of Object.entries(obj)) {
      if (!/(result|utile|profit|income|loss|amount|value|valore|netto)/i.test(key)) continue
      const n = firstNestedNumber(value)
      if (n !== undefined) return n
    }
  }
  return undefined
}

function pickProfit(balance: Record<string, unknown>): number | undefined {
  for (const key of ['profit', 'netProfit', 'netIncome', 'profitOrLoss', 'netResult', 'utileNetto', 'risultatoEsercizio', 'profitLossForYear']) {
    const n = toNumber(balance[key])
    if (n !== undefined) return n
  }
  return firstNestedNumber(balance.annualResult || balance.annualResults || (balance.profitAndLoss as any)?.annualResult || (balance.incomeStatement as any)?.annualResult)
}

function hasAdvancedData(data: OpenApiAdvancedData | null | undefined) {
  return Boolean(
    data?.ragione_sociale ||
    data?.sede_legale ||
    data?.codice_ateco ||
    data?.forma_giuridica ||
    data?.codice_rea ||
    data?.pec ||
    typeof data?.fatturato === 'number' ||
    typeof data?.dipendenti === 'number' ||
    data?.shareholders?.length
  )
}

function mapAdvancedResponse(json: any): OpenApiAdvancedData | null {
  const rawData = json?.data
  const c = Array.isArray(rawData) ? rawData[0] : rawData
  if (!c || typeof c !== 'object') return null
  const office = c.address?.registeredOffice || c.registeredOffice || {}
  const atecoClass = c.atecoClassification || {}
  const ateco = atecoClass.ateco2007 || atecoClass.ateco || {}
  const bs = c.balanceSheets?.last || {}
  const allBs = (c.balanceSheets?.all || []) as any[]
  const rawShareholders = (c.shareHolders || c.shareholders || []) as any[]
  const shareholders = rawShareholders
    .map((sh) => ({
      nome: String(sh?.name || '').trim(),
      cognome: String(sh?.surname || '').trim(),
      ragione_sociale_socio: sh?.companyName || undefined,
      taxCode: sh?.taxCode || sh?.cf || undefined,
      percentShare: typeof sh?.percentShare === 'number' ? sh.percentShare : typeof sh?.percentShare === 'string' ? parseFloat(sh.percentShare) : undefined,
      isCompany: Boolean(sh?.companyName) || (!sh?.name && !sh?.surname),
    }))
    .filter((s) => s.nome || s.cognome || s.taxCode || s.ragione_sociale_socio)
  const storicoBilanci = allBs
    .filter((b) => b && typeof b.year === 'number')
    .map((b) => ({
      anno: b.year,
      fatturato: typeof b.turnover === 'number' ? b.turnover : undefined,
      utile: pickProfit(b),
      dipendenti: typeof b.employees === 'number' ? b.employees : undefined,
      capitale_sociale: typeof b.shareCapital === 'number' ? b.shareCapital : undefined,
      costo_personale: typeof b.totalStaffCost === 'number' ? b.totalStaffCost : undefined,
      patrimonio_netto: typeof b.netWorth === 'number' ? b.netWorth : undefined,
      totale_attivo: typeof b.totalAssets === 'number' ? b.totalAssets : undefined,
    }))
    .sort((a, b) => b.anno - a.anno)
  const latest = (field: keyof (typeof storicoBilanci)[number]) => storicoBilanci.find((y) => typeof y[field] === 'number')?.[field] as number | undefined
  const mapped: OpenApiAdvancedData = {
    ragione_sociale: c.companyName || c.name || undefined,
    partita_iva: c.vatCode || c.taxCode || undefined,
    codice_fiscale: c.taxCode || undefined,
    sede_legale: [office.streetName, office.zipCode, office.town, office.province].filter(Boolean).join(', ') || undefined,
    indirizzo_via: office.streetName || [office.toponym, office.street, office.streetNumber].filter(Boolean).join(' ') || undefined,
    indirizzo_numero_civico: office.streetNumber || undefined,
    citta: office.town || undefined,
    provincia: office.province || undefined,
    cap: office.zipCode || undefined,
    regione: office.region?.description || undefined,
    gps_lat: office.gps?.coordinates?.[1] ?? undefined,
    gps_lng: office.gps?.coordinates?.[0] ?? undefined,
    stato_attivita: c.activityStatus || c.status || undefined,
    codice_ateco: ateco.code || c.atecoCode || undefined,
    descrizione_ateco: ateco.description || c.atecoDescription || undefined,
    forma_giuridica: c.detailedLegalForm?.description || c.legalForm || undefined,
    forma_giuridica_codice: c.detailedLegalForm?.code || undefined,
    codice_rea: c.reaCode && c.cciaa ? `${c.cciaa} ${c.reaCode}` : c.reaCode || undefined,
    cciaa: c.cciaa || undefined,
    pec: c.pec || c.certifiedEmail || undefined,
    data_registrazione: c.registrationDate ? String(c.registrationDate).split('T')[0] : undefined,
    data_costituzione: c.startDate ? String(c.startDate).split('T')[0] : c.incorporationDate ? String(c.incorporationDate).split('T')[0] : undefined,
    data_cessazione: c.endDate ? String(c.endDate).split('T')[0] : undefined,
    codice_sdi: c.sdiCode || undefined,
    capitale_sociale: typeof (bs.shareCapital ?? c.shareCapital) === 'number' ? Number(bs.shareCapital ?? c.shareCapital) : latest('capitale_sociale'),
    fatturato: typeof bs.turnover === 'number' ? bs.turnover : typeof bs.operatingRevenue === 'number' ? bs.operatingRevenue : typeof c.revenue === 'number' ? c.revenue : latest('fatturato'),
    fatturato_anno: bs.year ?? storicoBilanci.find((y) => typeof y.fatturato === 'number')?.anno,
    dipendenti: typeof bs.employees === 'number' ? bs.employees : typeof c.employeesNumber === 'number' ? c.employeesNumber : latest('dipendenti'),
    costo_personale: typeof bs.totalStaffCost === 'number' ? bs.totalStaffCost : latest('costo_personale'),
    patrimonio_netto: typeof bs.netWorth === 'number' ? bs.netWorth : latest('patrimonio_netto'),
    totale_attivo: typeof bs.totalAssets === 'number' ? bs.totalAssets : latest('totale_attivo'),
    utile_netto: pickProfit(bs) ?? latest('utile'),
    ral_medio: typeof bs.avgGrossSalary === 'number' ? Math.round(bs.avgGrossSalary) : undefined,
    storico_bilanci: storicoBilanci.length > 0 ? storicoBilanci : undefined,
    telefono: c.contacts?.phone || c.phone || undefined,
    sito_web: c.contacts?.website || c.website || undefined,
    shareholders: shareholders.length ? shareholders : undefined,
    openapi_id: c.id || undefined,
    timestamp_creazione: c.creationTimestamp || undefined,
    timestamp_aggiornamento: c.lastUpdateTimestamp || undefined,
  }
  return hasAdvancedData(mapped) ? mapped : null
}

export async function searchByCompanyName(name: string): Promise<OpenApiResult<OpenApiSearchHit[]>> {
  const source: OpenApiSource = 'openapi_it_search'
  if (!enabled()) return { success: false, data: null, source, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  const q = String(name || '').trim()
  if (q.length < 3) return { success: false, data: null, source, fromCache: false, errorMessage: 'query too short' }
  const cacheKey = `q:${q.toLowerCase()}`
  const cached = await readCache<OpenApiSearchHit[]>(cacheKey, source)
  if (cached) return { success: true, data: cached, source, fromCache: true, costEur: 0 }
  return withInFlight(`${source}:${cacheKey}`, async () => {
    const cachedAgain = await readCache<OpenApiSearchHit[]>(cacheKey, source)
    if (cachedAgain) return { success: true, data: cachedAgain, source, fromCache: true, costEur: 0 }
    try {
      const res = await fetch(`https://company.openapi.com/IT-search?companyName=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return { success: false, data: null, source, fromCache: false, errorMessage: `HTTP ${res.status}` }
      const json = await res.json()
      const items = (json?.data || []) as any[]
      const hits = items.map((it) => ({
        ragione_sociale: String(it.companyName || it.name || ''),
        partita_iva: String(it.taxCode || it.vatCode || '').replace(/\D/g, ''),
        citta: it.registeredOffice?.city || it.address?.registeredOffice?.town || undefined,
        provincia: it.registeredOffice?.province || it.address?.registeredOffice?.province || undefined,
        indirizzo: it.registeredOffice?.street || it.address?.registeredOffice?.streetName || undefined,
        forma_giuridica: it.legalForm || it.detailedLegalForm?.description || undefined,
        pec: it.certifiedEmail || it.pec || undefined,
        stato_attivita: it.status || it.activityStatus || undefined,
      })).filter((h: OpenApiSearchHit) => h.partita_iva.length === 11)
      await writeCache(cacheKey, source, hits, CACHE_DAYS_SEARCH)
      return { success: true, data: hits, source, fromCache: false, costEur: 0 }
    } catch (e: any) {
      return { success: false, data: null, source, fromCache: false, errorMessage: e?.message || 'network error' }
    }
  })
}

export async function getItAdvanced(piva: string): Promise<OpenApiResult<OpenApiAdvancedData>> {
  const source: OpenApiSource = 'openapi_it_advanced'
  if (!enabled()) return { success: false, data: null, source, fromCache: false, skipped: OPENAPI_IT_TOKEN ? 'mode_off' : 'no_token' }
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return { success: false, data: null, source, fromCache: false, errorMessage: 'invalid piva' }
  const cached = await readCache<OpenApiAdvancedData>(clean, source)
  if (cached && hasAdvancedData(cached)) return { success: true, data: cached, source, fromCache: true, costEur: 0 }
  return withInFlight(`${source}:${clean}`, async () => {
    const cachedAgain = await readCache<OpenApiAdvancedData>(clean, source)
    if (cachedAgain && hasAdvancedData(cachedAgain)) return { success: true, data: cachedAgain, source, fromCache: true, costEur: 0 }
    if (!(await walletAllows())) return { success: false, data: null, source, fromCache: false, skipped: 'wallet_low' }
    try {
      const res = await fetch(`https://company.openapi.com/IT-advanced/${clean}`, {
        headers: { Authorization: `Bearer ${OPENAPI_IT_TOKEN}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) return { success: false, data: null, source, fromCache: false, errorMessage: `HTTP ${res.status}` }
      const json = await res.json()
      const mapped = mapAdvancedResponse(json)
      if (!mapped) return { success: false, data: null, source, fromCache: false, errorMessage: 'empty response' }
      await writeCache(clean, source, mapped, CACHE_DAYS_ADVANCED, mapped.ragione_sociale)
      return { success: true, data: mapped, source, fromCache: false, costEur: 0.1 }
    } catch (e: any) {
      return { success: false, data: null, source, fromCache: false, errorMessage: e?.message || 'network error' }
    }
  })
}

export async function enrichCompanyByPiva(piva: string): Promise<OpenApiEnrichedCompany | null> {
  const clean = cleanPiva(piva)
  if (clean.length !== 11) return null
  const advanced = await getItAdvanced(clean)
  if (!advanced.success || !advanced.data) return null
  const enriched: OpenApiEnrichedCompany = {
    ...advanced.data,
    cost_incurred_eur: advanced.costEur || 0,
    cached_hits: advanced.fromCache ? 1 : 0,
    live_calls: advanced.fromCache ? 0 : 1,
  }
  const shareholders = advanced.data.shareholders || []
  const firstPerson = shareholders.find((s) => !s.isCompany && s.nome && s.cognome)
  if (firstPerson) {
    const nome = firstPerson.nome.charAt(0).toUpperCase() + firstPerson.nome.slice(1).toLowerCase()
    const cognome = firstPerson.cognome.charAt(0).toUpperCase() + firstPerson.cognome.slice(1).toLowerCase()
    enriched.titolare_best = {
      nome,
      cognome,
      nomeCompleto: `${nome} ${cognome}`,
      ruolo: shareholders.length === 1 ? 'Socio Unico' : 'Socio',
      taxCode: firstPerson.taxCode,
      source: 'shareholders',
    }
  }
  return enriched
}
