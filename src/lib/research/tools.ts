import type {
  CheckApiParams,
  ReadPageParams,
  ResearchToolName,
  ResearchToolResult,
  SearchWebParams,
  VerifyFactParams,
} from './types.ts'

const FETCH_TIMEOUT_MS = 4000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
}

export async function searchWeb(params: SearchWebParams): Promise<ResearchToolResult> {
  const query = params.query?.trim()
  if (!query) return { tool: 'search_web', ok: false, data: [], error: 'query vuota' }

  const max = Math.min(10, Math.max(1, params.max_results ?? 5))
  const serperKey = process.env.SERPER_API_KEY
  const braveKey = process.env.BRAVE_SEARCH_API_KEY

  try {
    if (serperKey) {
      const res = await fetchWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: max, gl: 'it', hl: 'it' }),
      })
      if (res.ok) {
        const json = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> }
        const hits = (json.organic ?? []).slice(0, max).map((r) => ({
          title: r.title ?? '',
          url: r.link ?? '',
          snippet: r.snippet ?? '',
        }))
        return { tool: 'search_web', ok: true, data: hits }
      }
    }

    if (braveKey) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search')
      url.searchParams.set('q', query)
      url.searchParams.set('count', String(max))
      url.searchParams.set('country', 'it')
      const res = await fetchWithTimeout(url.toString(), {
        headers: { 'X-Subscription-Token': braveKey, Accept: 'application/json' },
      })
      if (res.ok) {
        const json = (await res.json()) as {
          web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
        }
        const hits = (json.web?.results ?? []).slice(0, max).map((r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.description ?? '',
        }))
        return { tool: 'search_web', ok: true, data: hits }
      }
    }

    return { tool: 'search_web', ok: true, data: [], error: 'Nessuna API search configurata (SERPER/BRAVE)' }
  } catch (e) {
    return {
      tool: 'search_web',
      ok: false,
      data: [],
      error: e instanceof Error ? e.message : 'search_web failed',
    }
  }
}

export async function readPage(params: ReadPageParams): Promise<ResearchToolResult> {
  const url = params.url?.trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    return { tool: 'read_page', ok: false, data: null, error: 'URL non valido' }
  }
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'MIRAX-Research-Agent/1.0 (+https://ecosistema-mirax.vercel.app)' },
    })
    if (!res.ok) return { tool: 'read_page', ok: false, data: null, error: `HTTP ${res.status}` }
    const html = await res.text()
    const text = stripHtml(html)
    return {
      tool: 'read_page',
      ok: true,
      data: { url, text_length: text.length, excerpt: text.slice(0, 2500) },
    }
  } catch (e) {
    return {
      tool: 'read_page',
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : 'read_page failed',
    }
  }
}

const ALLOWED_API_HOSTS = [
  'dati.anticorruzione.it',
  'openapi.it',
  'ted.europa.eu',
  'api.openapi.it',
]

export async function checkApi(params: CheckApiParams): Promise<ResearchToolResult> {
  const endpoint = params.endpoint?.trim()
  if (!endpoint) return { tool: 'check_api', ok: false, data: null, error: 'endpoint vuoto' }

  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return { tool: 'check_api', ok: false, data: null, error: 'endpoint malformato' }
  }

  if (!ALLOWED_API_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
    return { tool: 'check_api', ok: false, data: null, error: 'host API non consentito' }
  }

  if (params.params) {
    for (const [k, v] of Object.entries(params.params)) parsed.searchParams.set(k, v)
  }

  try {
    const res = await fetchWithTimeout(parsed.toString(), {
      headers: { Accept: 'application/json' },
    })
    const body = await res.text()
    let data: unknown = body.slice(0, 4000)
    try {
      data = JSON.parse(body)
    } catch {
      /* testo grezzo */
    }
    return { tool: 'check_api', ok: res.ok, data, error: res.ok ? undefined : `HTTP ${res.status}` }
  } catch (e) {
    return {
      tool: 'check_api',
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : 'check_api failed',
    }
  }
}

export async function verifyFact(params: VerifyFactParams): Promise<ResearchToolResult> {
  const claim = params.claim?.trim()
  const sources = (params.sources ?? []).filter((s) => /^https?:\/\//i.test(s))
  if (!claim || sources.length < 1) {
    return { tool: 'verify_fact', ok: false, data: { agreement_score: 0 }, error: 'claim o sources mancanti' }
  }

  const excerpts: string[] = []
  for (const src of sources.slice(0, 3)) {
    const page = await readPage({ url: src })
    if (page.ok && page.data && typeof page.data === 'object') {
      const excerpt = String((page.data as { excerpt?: string }).excerpt ?? '')
      if (excerpt) excerpts.push(excerpt.toLowerCase())
    }
  }

  const claimTokens = claim
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 4)
    .slice(0, 12)
  if (claimTokens.length === 0) {
    return { tool: 'verify_fact', ok: true, data: { agreement_score: 0, matched_sources: 0 } }
  }

  let matched = 0
  for (const ex of excerpts) {
    const hits = claimTokens.filter((t) => ex.includes(t)).length
    if (hits >= Math.ceil(claimTokens.length * 0.35)) matched += 1
  }

  const agreement_score = excerpts.length > 0 ? matched / excerpts.length : 0
  return {
    tool: 'verify_fact',
    ok: true,
    data: { agreement_score, matched_sources: matched, sources_checked: excerpts.length },
  }
}

export async function runResearchTool(
  name: ResearchToolName,
  params: SearchWebParams | ReadPageParams | CheckApiParams | VerifyFactParams,
): Promise<ResearchToolResult> {
  switch (name) {
    case 'search_web':
      return searchWeb(params as SearchWebParams)
    case 'read_page':
      return readPage(params as ReadPageParams)
    case 'check_api':
      return checkApi(params as CheckApiParams)
    case 'verify_fact':
      return verifyFact(params as VerifyFactParams)
    default:
      return { tool: name, ok: false, data: null, error: 'tool sconosciuto' }
  }
}
