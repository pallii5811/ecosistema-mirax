// ────────────────────────────────────────────────────────────────
//  FREE ENRICHMENT — 100% gratuito, zero API a pagamento
// ────────────────────────────────────────────────────────────────
//  Tutte le fonti restituiscono `null` su errore (mai throw).
//  Ogni funzione ha un timeout aggressivo per non bloccare la UI.
// ────────────────────────────────────────────────────────────────

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── Types ──────────────────────────────────────────────────────────────────

export type FreeIntel = {
  performance: PageSpeedResult | null
  security: SecurityResult | null
  domain: DomainResult | null
  emailProvider: EmailProvider | null
  audit: WebsiteAuditResult | null
  triggers: SalesTrigger[]
}

export type PageSpeedResult = {
  strategy: 'mobile'
  // Lighthouse scores 0-100 (null se non disponibile)
  performance: number | null
  accessibility: number | null
  bestPractices: number | null
  seo: number | null
  // Core Web Vitals (lab data, ms o decimali)
  lcpMs: number | null
  inpMs: number | null
  clsScore: number | null
  tbtMs: number | null
  fcpMs: number | null
  ttfbMs: number | null
  // Field data CrUX (utenti reali Chrome) — quando disponibile
  fieldLcpCategory: 'FAST' | 'AVERAGE' | 'SLOW' | null
  fieldClsCategory: 'FAST' | 'AVERAGE' | 'SLOW' | null
  // Top 5 audit fallite ordinate per impatto
  topIssues: { id: string; title: string; savingMs: number | null }[]
}

export type SecurityResult = {
  hsts: boolean
  csp: boolean
  xFrameOptions: boolean
  xContentType: boolean
  referrerPolicy: boolean
  permissionsPolicy: boolean
  cookieSecure: boolean | null
  server: string | null
  cdn:
    | 'cloudflare'
    | 'fastly'
    | 'aws_cloudfront'
    | 'vercel'
    | 'netlify'
    | 'akamai'
    | null
  // Punteggio 0-5 (1 punto per ogni header critico presente)
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  score: number
}

export type DomainResult = {
  domain: string
  registeredYear: number | null
  ageYears: number | null
  expiresInDays: number | null
  registrar: string | null
  nameservers: string[]
}

export type EmailProvider =
  | 'google_workspace'
  | 'microsoft_365'
  | 'aruba'
  | 'zoho'
  | 'register_it'
  | 'libero'
  | 'other'

export type WebsiteAuditResult = {
  // Tech rilevate (booleans, sempre presenti)
  pixels: PixelDetection
  emailMarketing: EmailMarketingDetection
  crm: CrmDetection
  liveChat: LiveChatDetection
  booking: BookingDetection
  abTesting: AbTestingDetection
  heatmap: HeatmapDetection
  ecommerce: EcommerceDetection
  cms: string | null
  // Schema.org
  schemaTypes: string[]
  hasLocalBusiness: boolean
  hasProductSchema: boolean
  hasFaqSchema: boolean
  hasReviewSchema: boolean
  // Conversion elements
  contactFormCount: number
  hasNewsletterForm: boolean
  hasWhatsappButton: boolean
  hasCalendarBooking: boolean
  hasClickablePhone: boolean
  hasClickableEmail: boolean
  // SEO basics
  titleLength: number | null
  metaDescriptionLength: number | null
  h1Count: number
  hasOpenGraph: boolean
  hasTwitterCards: boolean
  hasCanonical: boolean
  hasRobotsMeta: boolean
  hasHreflang: boolean
  languages: string[]
  // Riepilogo
  pixelCount: number
  toolCount: number
}

export type PixelDetection = {
  metaPixel: boolean
  googleAnalytics: boolean
  googleAds: boolean
  googleTagManager: boolean
  tiktokPixel: boolean
  linkedinInsight: boolean
  pinterestTag: boolean
  twitterPixel: boolean
  redditPixel: boolean
  snapchatPixel: boolean
  microsoftUet: boolean
  quoraPixel: boolean
}

export type EmailMarketingDetection = {
  mailchimp: boolean
  klaviyo: boolean
  brevo: boolean
  activecampaign: boolean
  mailerlite: boolean
  convertkit: boolean
  getresponse: boolean
  iterable: boolean
  drip: boolean
  customerio: boolean
  sendgrid: boolean
}

export type CrmDetection = {
  hubspot: boolean
  salesforce: boolean
  pardot: boolean
  marketo: boolean
  pipedrive: boolean
  zoho: boolean
  freshworks: boolean
}

export type LiveChatDetection = {
  intercom: boolean
  drift: boolean
  tawkTo: boolean
  zendeskChat: boolean
  crisp: boolean
  tidio: boolean
  liveChatInc: boolean
  userlike: boolean
}

export type BookingDetection = {
  calendly: boolean
  booksy: boolean
  treatwell: boolean
  fresha: boolean
  thefork: boolean
  opentable: boolean
  resy: boolean
  simplyBook: boolean
  acuity: boolean
}

export type AbTestingDetection = {
  optimizely: boolean
  vwo: boolean
  abTasty: boolean
  googleOptimize: boolean
  convert: boolean
}

export type HeatmapDetection = {
  hotjar: boolean
  microsoftClarity: boolean
  fullStory: boolean
  mouseflow: boolean
  luckyOrange: boolean
  smartlook: boolean
}

export type EcommerceDetection = {
  shopify: boolean
  woocommerce: boolean
  magento: boolean
  prestashop: boolean
  bigcommerce: boolean
  squarespaceCommerce: boolean
}

export type SalesTrigger = {
  category: 'marketing' | 'social' | 'tech' | 'security' | 'seo' | 'ux'
  severity: 'critical' | 'high' | 'medium' | 'info'
  title: string
  detail: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    return u.toString()
  } catch {
    return null
  }
}

function extractDomain(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    return u.hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

function safeNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

// ── 1. Google PageSpeed Insights ──────────────────────────────────────────
//
// API gratuita: https://developers.google.com/speed/docs/insights/v5/get-started
// Senza chiave: ~4 req/s. Con chiave: 25.000/giorno.
//
export async function runPageSpeedInsights(rawUrl: string): Promise<PageSpeedResult | null> {
  const url = normalizeUrl(rawUrl)
  if (!url) return null

  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY || ''
  const params = new URLSearchParams({ url, strategy: 'mobile' })
  ;['performance', 'accessibility', 'best-practices', 'seo'].forEach((c) =>
    params.append('category', c),
  )
  if (apiKey) params.set('key', apiKey)

  try {
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
      { signal: AbortSignal.timeout(40000) },
    )
    if (!res.ok) return null
    const json: any = await res.json()
    const lh = json?.lighthouseResult
    if (!lh) return null

    const cat = lh.categories || {}
    const audits = lh.audits || {}
    const cruxFieldData = json?.loadingExperience?.metrics || {}

    const lcpMs = safeNum(audits['largest-contentful-paint']?.numericValue)
    const inpMs =
      safeNum(audits['interaction-to-next-paint']?.numericValue) ??
      safeNum(audits['max-potential-fid']?.numericValue)
    const clsScore = safeNum(audits['cumulative-layout-shift']?.numericValue)
    const tbtMs = safeNum(audits['total-blocking-time']?.numericValue)
    const fcpMs = safeNum(audits['first-contentful-paint']?.numericValue)
    const ttfbMs = safeNum(audits['server-response-time']?.numericValue)

    const fieldLcp = cruxFieldData?.LARGEST_CONTENTFUL_PAINT_MS?.category as
      | 'FAST'
      | 'AVERAGE'
      | 'SLOW'
      | undefined
    const fieldCls = cruxFieldData?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category as
      | 'FAST'
      | 'AVERAGE'
      | 'SLOW'
      | undefined

    // Top issue: audit con score < 0.9 ordinati per overallSavingsMs desc
    const issues: { id: string; title: string; savingMs: number | null }[] = []
    for (const id of Object.keys(audits)) {
      const a = audits[id]
      if (!a || typeof a !== 'object') continue
      if (typeof a.score !== 'number' || a.score >= 0.9) continue
      if (a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'manual') continue
      const saving =
        safeNum(a.details?.overallSavingsMs) ?? safeNum(a.numericValue) ?? null
      if (a.title) issues.push({ id, title: String(a.title), savingMs: saving })
    }
    issues.sort((a, b) => (b.savingMs || 0) - (a.savingMs || 0))

    const toScore = (v: any): number | null => {
      const n = safeNum(v?.score)
      return n == null ? null : Math.round(n * 100)
    }

    return {
      strategy: 'mobile',
      performance: toScore(cat.performance),
      accessibility: toScore(cat.accessibility),
      bestPractices: toScore(cat['best-practices']),
      seo: toScore(cat.seo),
      lcpMs: lcpMs == null ? null : Math.round(lcpMs),
      inpMs: inpMs == null ? null : Math.round(inpMs),
      clsScore: clsScore == null ? null : Number(clsScore.toFixed(3)),
      tbtMs: tbtMs == null ? null : Math.round(tbtMs),
      fcpMs: fcpMs == null ? null : Math.round(fcpMs),
      ttfbMs: ttfbMs == null ? null : Math.round(ttfbMs),
      fieldLcpCategory: fieldLcp || null,
      fieldClsCategory: fieldCls || null,
      topIssues: issues.slice(0, 5),
    }
  } catch {
    return null
  }
}

// ── Shared single fetch (security audit + website audit usano gli stessi dati) ──

type SiteFetchResult = { headers: Headers; html: string }

async function fetchSiteOnce(rawUrl: string): Promise<SiteFetchResult | null> {
  const url = normalizeUrl(rawUrl)
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const html = await res.text()
    return { headers: res.headers, html }
  } catch {
    return null
  }
}

// ── 2. Security headers + CDN/server detection ─────────────────────────────

function analyzeSecurityHeaders(headers: Headers): SecurityResult {
  const get = (n: string) => headers.get(n) || headers.get(n.toLowerCase())

  const hsts = !!get('strict-transport-security')
  const csp = !!get('content-security-policy')
  const xFrame = !!get('x-frame-options')
  const xContent = !!get('x-content-type-options')
  const referrer = !!get('referrer-policy')
  const permissions = !!get('permissions-policy') || !!get('feature-policy')
  const setCookie = get('set-cookie')
  const cookieSecure = setCookie ? /Secure/i.test(setCookie) : null
  const server = get('server')

  let cdn: SecurityResult['cdn'] = null
  if (get('cf-ray') || /cloudflare/i.test(server || '')) cdn = 'cloudflare'
  else if (/fastly/i.test(get('via') || server || '') || get('x-served-by')) cdn = 'fastly'
  else if (get('x-amz-cf-id')) cdn = 'aws_cloudfront'
  else if (get('x-vercel-id') || /vercel/i.test(server || '')) cdn = 'vercel'
  else if (/netlify/i.test(server || '') || get('x-nf-request-id')) cdn = 'netlify'
  else if (/akamai/i.test(server || '') || get('x-akamai-transformed')) cdn = 'akamai'

  const score =
    Number(hsts) +
    Number(csp) +
    Number(xFrame) +
    Number(xContent) +
    Number(referrer) +
    Number(permissions)
  const grade: SecurityResult['grade'] =
    score >= 6 ? 'A' : score >= 5 ? 'B' : score >= 3 ? 'C' : score >= 2 ? 'D' : 'F'

  return {
    hsts,
    csp,
    xFrameOptions: xFrame,
    xContentType: xContent,
    referrerPolicy: referrer,
    permissionsPolicy: permissions,
    cookieSecure,
    server: server ? server.split(' ')[0].slice(0, 64) : null,
    cdn,
    grade,
    score,
  }
}

// API pubblica backward-compatible: standalone fa la fetch
export async function runSecurityAudit(rawUrl: string): Promise<SecurityResult | null> {
  const data = await fetchSiteOnce(rawUrl)
  return data ? analyzeSecurityHeaders(data.headers) : null
}

// ── 3. WHOIS / RDAP per età e scadenza dominio ─────────────────────────────

export async function runDomainWhois(rawUrl: string): Promise<DomainResult | null> {
  const u = normalizeUrl(rawUrl)
  if (!u) return null
  const domain = extractDomain(u)
  if (!domain) return null

  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { domain, registeredYear: null, ageYears: null, expiresInDays: null, registrar: null, nameservers: [] }
    const json: any = await res.json()

    const events: any[] = Array.isArray(json?.events) ? json.events : []
    const registrationEvt = events.find((e) => e?.eventAction === 'registration')
    const expirationEvt = events.find((e) => e?.eventAction === 'expiration')

    const registeredYear = registrationEvt?.eventDate
      ? new Date(registrationEvt.eventDate).getFullYear() || null
      : null
    const ageYears =
      registeredYear && Number.isFinite(registeredYear)
        ? Math.max(0, new Date().getFullYear() - registeredYear)
        : null

    let expiresInDays: number | null = null
    if (expirationEvt?.eventDate) {
      const ms = Date.parse(expirationEvt.eventDate)
      if (Number.isFinite(ms)) {
        expiresInDays = Math.round((ms - Date.now()) / (1000 * 60 * 60 * 24))
      }
    }

    let registrar: string | null = null
    const entities: any[] = Array.isArray(json?.entities) ? json.entities : []
    for (const ent of entities) {
      const roles = Array.isArray(ent?.roles) ? ent.roles : []
      if (roles.includes('registrar')) {
        const vc = Array.isArray(ent?.vcardArray?.[1]) ? ent.vcardArray[1] : []
        const fnEntry = vc.find((x: any) => Array.isArray(x) && x[0] === 'fn')
        if (fnEntry && typeof fnEntry[3] === 'string') {
          registrar = fnEntry[3]
          break
        }
        if (typeof ent?.handle === 'string') {
          registrar = ent.handle
          break
        }
      }
    }

    const nameservers: string[] = Array.isArray(json?.nameservers)
      ? json.nameservers
          .map((n: any) => (typeof n?.ldhName === 'string' ? n.ldhName.toLowerCase() : null))
          .filter((x: string | null): x is string => !!x)
          .slice(0, 4)
      : []

    return { domain, registeredYear, ageYears, expiresInDays, registrar, nameservers }
  } catch {
    return null
  }
}

// ── 4. DNS MX → email provider ─────────────────────────────────────────────

export async function runEmailMxLookup(rawUrl: string): Promise<EmailProvider | null> {
  const u = normalizeUrl(rawUrl)
  if (!u) return null
  const domain = extractDomain(u)
  if (!domain) return null

  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) },
    )
    if (!res.ok) return null
    const json: any = await res.json()
    const answers: any[] = Array.isArray(json?.Answer) ? json.Answer : []
    const records = answers
      .map((a) => (typeof a?.data === 'string' ? a.data.toLowerCase() : ''))
      .join(' ')

    if (!records) return null
    if (/google\.com|googlemail\.com|aspmx\.l\.google\.com/.test(records)) return 'google_workspace'
    if (/outlook\.com|mail\.protection\.outlook\.com|microsoft/.test(records))
      return 'microsoft_365'
    if (/aruba\.it|pec\.aruba/.test(records)) return 'aruba'
    if (/zoho\.com|zohomail/.test(records)) return 'zoho'
    if (/register\.it/.test(records)) return 'register_it'
    if (/libero\.it|iol\.it/.test(records)) return 'libero'
    return 'other'
  } catch {
    return null
  }
}

// ── 5. Website audit (single fetch, multi-detection) ───────────────────────

function analyzeWebsiteHtml(html: string): WebsiteAuditResult | null {
  if (!html) return null
  const lower = html.toLowerCase()
  const has = (...needles: string[]) => needles.some((n) => lower.includes(n))

  // Pixel
  const pixels: PixelDetection = {
    metaPixel: has('connect.facebook.net/en_us/fbevents.js', 'fbq(', 'facebook pixel', 'fbevents.js'),
    googleAnalytics: has('google-analytics.com/analytics.js', 'googletagmanager.com/gtag/js', 'gtag(', 'ga(', 'g-', 'ua-'),
    googleAds: has('googleadservices.com', 'aw-conversion', 'gtag/js?id=aw-'),
    googleTagManager: has('googletagmanager.com/gtm.js', 'gtm-'),
    tiktokPixel: has('analytics.tiktok.com', 'ttq.load', 'ttq.page'),
    linkedinInsight: has('snap.licdn.com', '_linkedin_partner_id', 'linkedin insight'),
    pinterestTag: has('s.pinimg.com/ct/core.js', 'pintrk('),
    twitterPixel: has('static.ads-twitter.com', 'twq('),
    redditPixel: has('redditstatic.com/ads/pixel.js', 'rdt('),
    snapchatPixel: has('sc-static.net/scevent.min.js', 'snaptr('),
    microsoftUet: has('bat.bing.com/bat.js', 'uetq.push'),
    quoraPixel: has('q.quora.com/_/ad/'),
  }

  const emailMarketing: EmailMarketingDetection = {
    mailchimp: has('list-manage.com', 'mailchimp.com', 'mc.us'),
    klaviyo: has('klaviyo.com', 'static.klaviyo.com'),
    brevo: has('sibautomation.com', 'sendinblue.com', 'brevo.com'),
    activecampaign: has('activehosted.com', 'activecampaign.com'),
    mailerlite: has('mailerlite.com', 'mlsend.com'),
    convertkit: has('convertkit.com', 'ck.page'),
    getresponse: has('getresponse.com'),
    iterable: has('iterable.com'),
    drip: has('getdrip.com'),
    customerio: has('customer.io'),
    sendgrid: has('sendgrid.com', 'sendgrid.net'),
  }

  const crm: CrmDetection = {
    hubspot: has('js.hs-scripts.com', 'js.hs-analytics.net', 'hubspot.com/_hcms', 'hsforms.net'),
    salesforce: has('salesforce.com', 'force.com', 'salesforceliveagent'),
    pardot: has('pardot.com', 'pi.pardot.com'),
    marketo: has('mktoresp.com', 'marketo.com', 'munchkin.js'),
    pipedrive: has('pipedrive.com', 'leadbooster-chat'),
    zoho: has('zoho.com', 'zohopublic.com', 'zohostatic.com'),
    freshworks: has('freshworks.com', 'freshchat.com', 'fwcdn'),
  }

  const liveChat: LiveChatDetection = {
    intercom: has('widget.intercom.io', 'intercomcdn.com', 'intercomsettings'),
    drift: has('js.driftt.com', 'drift.com'),
    tawkTo: has('embed.tawk.to', 'tawk.to'),
    zendeskChat: has('static.zdassets.com', 'zopim.com', 'zendesk.com/embeddable'),
    crisp: has('client.crisp.chat'),
    tidio: has('code.tidio.co', 'tidio.com'),
    liveChatInc: has('cdn.livechatinc.com'),
    userlike: has('userlike-cdn-widgets', 'userlike.com'),
  }

  const booking: BookingDetection = {
    calendly: has('assets.calendly.com', 'calendly.com'),
    booksy: has('booksy.com'),
    treatwell: has('treatwell.it', 'treatwell.com'),
    fresha: has('fresha.com'),
    thefork: has('thefork.com', 'thefork.it'),
    opentable: has('opentable.com', 'opentable.it'),
    resy: has('resy.com'),
    simplyBook: has('simplybook.it', 'simplybook.me'),
    acuity: has('acuityscheduling.com', 'app.acuityscheduling'),
  }

  const abTesting: AbTestingDetection = {
    optimizely: has('cdn.optimizely.com', 'optimizely.com'),
    vwo: has('dev.visualwebsiteoptimizer.com', 'vwo.com'),
    abTasty: has('abtasty.com', 'try.abtasty.com'),
    googleOptimize: has('optimize.google.com', 'gtm-optimize'),
    convert: has('convert.com', 'cdn-3.convertexperiments.com'),
  }

  const heatmap: HeatmapDetection = {
    hotjar: has('static.hotjar.com', 'hotjar.com', 'hjsv'),
    microsoftClarity: has('clarity.ms', 'www.clarity.ms'),
    fullStory: has('edge.fullstory.com', 'fullstory.com'),
    mouseflow: has('mouseflow.com', 'cdn.mouseflow.com'),
    luckyOrange: has('luckyorange.com', 'luckyorange.net'),
    smartlook: has('smartlook.com', 'rec.smartlook.com'),
  }

  const ecommerce: EcommerceDetection = {
    shopify: has('cdn.shopify.com', 'shopify.com', 'shopifycdn'),
    woocommerce: has('woocommerce', 'wp-content/plugins/woocommerce'),
    magento: has('mage/cookies', 'mage-init', 'magento'),
    prestashop: has('prestashop', 'modules/prestashop'),
    bigcommerce: has('bigcommerce.com', 'cdn11.bigcommerce.com'),
    squarespaceCommerce: has('squarespace-cdn.com', 'static1.squarespace.com'),
  }

  // CMS heuristic
  let cms: string | null = null
  if (has('wp-content/', 'wp-includes/')) cms = 'WordPress'
  else if (ecommerce.shopify) cms = 'Shopify'
  else if (has('static.wixstatic.com', 'wix.com')) cms = 'Wix'
  else if (has('squarespace-cdn.com', 'static1.squarespace.com')) cms = 'Squarespace'
  else if (has('webflow.com', 'd3e54v103j8qbb.cloudfront.net')) cms = 'Webflow'
  else if (has('joomla')) cms = 'Joomla'
  else if (has('drupal.js', 'sites/default/files')) cms = 'Drupal'
  else if (has('typo3')) cms = 'TYPO3'
  else if (has('ghost.io', 'casper.ghost')) cms = 'Ghost'

  // Schema.org structured data
  const ldJsonBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []
  const schemaTypes = new Set<string>()
  for (const block of ldJsonBlocks) {
    const inner = block.replace(/^[^>]+>/, '').replace(/<\/script>$/i, '')
    try {
      const parsed = JSON.parse(inner)
      const collect = (obj: any) => {
        if (!obj || typeof obj !== 'object') return
        if (Array.isArray(obj)) {
          obj.forEach(collect)
          return
        }
        const t = obj['@type']
        if (typeof t === 'string') schemaTypes.add(t)
        else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && schemaTypes.add(x))
        if (obj['@graph']) collect(obj['@graph'])
      }
      collect(parsed)
    } catch {
      // ignore malformed JSON-LD
    }
  }
  // Microdata fallback
  const microdataMatches = html.match(/itemtype=["']https?:\/\/schema\.org\/([A-Za-z]+)/gi) || []
  for (const m of microdataMatches) {
    const name = m.split('/').pop()?.replace(/["']$/, '')
    if (name) schemaTypes.add(name)
  }

  const schemaArr = Array.from(schemaTypes)
  const hasLocalBusiness = schemaArr.some((t) =>
    /LocalBusiness|Restaurant|Store|MedicalBusiness|ProfessionalService|Dentist|HairSalon|AutoRepair|Hotel|TouristAttraction/.test(t),
  )
  const hasProductSchema = schemaArr.includes('Product')
  const hasFaqSchema = schemaArr.includes('FAQPage') || schemaArr.includes('Question')
  const hasReviewSchema = schemaArr.some((t) => /Review|AggregateRating/.test(t))

  // Conversion elements
  const formCount = (html.match(/<form\b/gi) || []).length
  const newsletterRegex = /newsletter|iscriviti.*newsletter|subscribe.*newsletter|signup|sign-up|sign_up/i
  const hasNewsletterForm =
    newsletterRegex.test(html) ||
    /name=["'](email|EMAIL)["'][^>]*placeholder=["'][^"']*newsletter/i.test(html)

  const hasWhatsappButton = /wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\/send/i.test(html)
  const hasCalendarBooking =
    booking.calendly ||
    booking.booksy ||
    booking.treatwell ||
    booking.fresha ||
    booking.thefork ||
    booking.opentable ||
    booking.resy ||
    booking.acuity ||
    booking.simplyBook
  const hasClickablePhone = /href=["']tel:[+\d]/i.test(html)
  const hasClickableEmail = /href=["']mailto:[^"']+@[^"']+/i.test(html)

  // SEO basics
  const titleMatch = html.match(/<title[^>]*>([^<]{0,400})<\/title>/i)
  const titleLength = titleMatch ? titleMatch[1].trim().length : null
  const metaDescMatch = html.match(/<meta\s+(?:name=["']description["']|property=["']og:description["'])[^>]*content=["']([^"']{0,500})["']/i)
  const metaDescriptionLength = metaDescMatch ? metaDescMatch[1].trim().length : null
  const h1Count = (html.match(/<h1\b/gi) || []).length
  const hasOpenGraph = /property=["']og:/i.test(html)
  const hasTwitterCards = /name=["']twitter:/i.test(html)
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html)
  const hasRobotsMeta = /<meta[^>]+name=["']robots["']/i.test(html)
  const hasHreflang = /hreflang=/i.test(html)

  const langs = new Set<string>()
  const langAttr = html.match(/<html[^>]+lang=["']([a-zA-Z\-]{2,8})["']/i)
  if (langAttr) langs.add(langAttr[1].toLowerCase().slice(0, 2))
  const hreflangMatches = html.match(/hreflang=["']([a-zA-Z\-]{2,8})["']/gi) || []
  for (const m of hreflangMatches) {
    const lang = m.match(/hreflang=["']([a-zA-Z\-]{2,8})["']/i)?.[1]?.toLowerCase().slice(0, 2)
    if (lang && lang !== 'x-') langs.add(lang)
  }

  const pixelCount = Object.values(pixels).filter(Boolean).length
  const toolCount =
    pixelCount +
    Object.values(emailMarketing).filter(Boolean).length +
    Object.values(crm).filter(Boolean).length +
    Object.values(liveChat).filter(Boolean).length +
    Object.values(booking).filter(Boolean).length +
    Object.values(abTesting).filter(Boolean).length +
    Object.values(heatmap).filter(Boolean).length +
    Object.values(ecommerce).filter(Boolean).length

  return {
    pixels,
    emailMarketing,
    crm,
    liveChat,
    booking,
    abTesting,
    heatmap,
    ecommerce,
    cms,
    schemaTypes: schemaArr,
    hasLocalBusiness,
    hasProductSchema,
    hasFaqSchema,
    hasReviewSchema,
    contactFormCount: formCount,
    hasNewsletterForm,
    hasWhatsappButton,
    hasCalendarBooking,
    hasClickablePhone,
    hasClickableEmail,
    titleLength,
    metaDescriptionLength,
    h1Count,
    hasOpenGraph,
    hasTwitterCards,
    hasCanonical,
    hasRobotsMeta,
    hasHreflang,
    languages: Array.from(langs),
    pixelCount,
    toolCount,
  }
}

// API pubblica backward-compatible: standalone fa la fetch
export async function runWebsiteAudit(rawUrl: string): Promise<WebsiteAuditResult | null> {
  const data = await fetchSiteOnce(rawUrl)
  return data ? analyzeWebsiteHtml(data.html) : null
}

// ── Sales triggers (derivati dai dati raccolti) ───────────────────────────

export function deriveSalesTriggers(intel: Omit<FreeIntel, 'triggers'>): SalesTrigger[] {
  const t: SalesTrigger[] = []
  const ps = intel.performance
  const sec = intel.security
  const dom = intel.domain
  const audit = intel.audit

  if (ps) {
    if (ps.performance != null && ps.performance < 50)
      t.push({
        category: 'tech',
        severity: 'critical',
        title: `Performance critica: ${ps.performance}/100`,
        detail:
          ps.lcpMs != null
            ? `LCP a ${(ps.lcpMs / 1000).toFixed(1)}s. Ogni 100ms in più = ~7% di conversioni perse.`
            : 'Sito lento: forte rischio bounce.',
      })
    if (ps.accessibility != null && ps.accessibility < 70)
      t.push({
        category: 'ux',
        severity: 'high',
        title: `Accessibilità ${ps.accessibility}/100`,
        detail: 'Problemi di accessibilità riducono pubblico potenziale e SEO.',
      })
    if (ps.seo != null && ps.seo < 80)
      t.push({
        category: 'seo',
        severity: 'high',
        title: `SEO ${ps.seo}/100`,
        detail: 'Score SEO basso: opportunità di crescita organica.',
      })
    if (ps.lcpMs != null && ps.lcpMs > 4000)
      t.push({
        category: 'tech',
        severity: 'critical',
        title: `LCP a ${(ps.lcpMs / 1000).toFixed(1)}s (target < 2.5s)`,
        detail: 'Caricamento prima immagine troppo lento, perde utenti su mobile.',
      })
    if (ps.clsScore != null && ps.clsScore > 0.25)
      t.push({
        category: 'ux',
        severity: 'high',
        title: `CLS ${ps.clsScore} (target < 0.1)`,
        detail: 'Layout instabile, esperienza utente compromessa.',
      })
  }

  if (sec) {
    if (!sec.hsts)
      t.push({
        category: 'security',
        severity: 'high',
        title: 'Manca HSTS',
        detail: 'Connessioni vulnerabili a downgrade attack.',
      })
    if (sec.grade === 'F' || sec.grade === 'D')
      t.push({
        category: 'security',
        severity: 'critical',
        title: `Sicurezza header: grade ${sec.grade}`,
        detail: 'Headers di sicurezza mancanti, audit consigliato.',
      })
  }

  if (dom?.expiresInDays != null && dom.expiresInDays > 0 && dom.expiresInDays < 90)
    t.push({
      category: 'tech',
      severity: 'high',
      title: `Dominio scade in ${dom.expiresInDays} giorni`,
      detail: 'Trigger commerciale: rinnovo + audit DNS.',
    })

  if (audit) {
    if (audit.pixelCount === 0)
      t.push({
        category: 'marketing',
        severity: 'critical',
        title: 'Nessun pixel di tracking installato',
        detail: 'Impossibile fare retargeting o misurare ROI ads.',
      })
    else if (audit.pixelCount === 1)
      t.push({
        category: 'marketing',
        severity: 'medium',
        title: 'Solo 1 pixel installato',
        detail: 'Retargeting cross-channel non possibile.',
      })

    if (!audit.pixels.metaPixel)
      t.push({
        category: 'marketing',
        severity: 'high',
        title: 'Meta Pixel assente',
        detail: 'Niente retargeting Facebook/Instagram, niente lookalike audience.',
      })
    if (!audit.pixels.googleTagManager && !audit.pixels.googleAnalytics)
      t.push({
        category: 'marketing',
        severity: 'critical',
        title: 'Niente Google Analytics o GTM',
        detail: 'Nessun dato sul traffico, decisioni alla cieca.',
      })

    if (audit.contactFormCount === 0 && !audit.hasClickablePhone && !audit.hasClickableEmail)
      t.push({
        category: 'marketing',
        severity: 'critical',
        title: 'Zero canali di contatto sul sito',
        detail: 'Niente form, niente telefono cliccabile, niente email cliccabile.',
      })
    else if (audit.contactFormCount === 0)
      t.push({
        category: 'marketing',
        severity: 'high',
        title: 'Nessun form di contatto',
        detail: 'Difficile generare lead inbound.',
      })

    if (!audit.hasLocalBusiness)
      t.push({
        category: 'seo',
        severity: 'medium',
        title: 'Schema LocalBusiness assente',
        detail: 'Manca rich snippet locale, peggior visibilità nelle ricerche locali.',
      })

    if (!audit.hasOpenGraph)
      t.push({
        category: 'social',
        severity: 'medium',
        title: 'Open Graph mancante',
        detail: 'Anteprime social rotte/povere su WhatsApp, FB, LinkedIn.',
      })

    if (audit.titleLength != null && (audit.titleLength < 20 || audit.titleLength > 70))
      t.push({
        category: 'seo',
        severity: 'medium',
        title: `Title tag ${audit.titleLength} caratteri (ottimo: 50-60)`,
        detail: 'Title tag fuori dalle best practice SEO.',
      })

    if (audit.h1Count === 0)
      t.push({
        category: 'seo',
        severity: 'high',
        title: 'Nessun H1 sulla homepage',
        detail: 'Errore SEO base: la pagina non ha titolo principale.',
      })
    else if (audit.h1Count > 1)
      t.push({
        category: 'seo',
        severity: 'medium',
        title: `${audit.h1Count} H1 sulla pagina`,
        detail: 'Best practice: un solo H1 per pagina.',
      })

    const noChat =
      !audit.liveChat.intercom &&
      !audit.liveChat.drift &&
      !audit.liveChat.tawkTo &&
      !audit.liveChat.zendeskChat &&
      !audit.liveChat.crisp &&
      !audit.liveChat.tidio &&
      !audit.liveChat.liveChatInc &&
      !audit.liveChat.userlike &&
      !audit.hasWhatsappButton
    if (noChat)
      t.push({
        category: 'marketing',
        severity: 'medium',
        title: 'Nessun canale di chat o WhatsApp',
        detail: 'Mancano canali di engagement immediato.',
      })

    const noEmail = !Object.values(audit.emailMarketing).some(Boolean)
    if (noEmail && audit.hasNewsletterForm)
      t.push({
        category: 'marketing',
        severity: 'medium',
        title: 'Form newsletter senza tool email marketing',
        detail: 'Newsletter non automatizzata: opportunità email automation.',
      })
  }

  // Ordina per severità
  const order: Record<SalesTrigger['severity'], number> = { critical: 0, high: 1, medium: 2, info: 3 }
  t.sort((a, b) => order[a.severity] - order[b.severity])

  return t
}

// ── Orchestratore principale ──────────────────────────────────────────────

export async function enrichLeadFree(rawWebsite: string): Promise<FreeIntel | null> {
  const url = normalizeUrl(rawWebsite)
  if (!url) return null

  // Una sola fetch del sito target, condivisa tra security audit e website audit.
  // Le fonti esterne (PageSpeed, RDAP, DNS) girano in parallelo.
  const [psRes, siteRes, domRes, mxRes] = await Promise.allSettled([
    runPageSpeedInsights(url),
    fetchSiteOnce(url),
    runDomainWhois(url),
    runEmailMxLookup(url),
  ])

  const siteData = siteRes.status === 'fulfilled' ? siteRes.value : null

  const intel: Omit<FreeIntel, 'triggers'> = {
    performance: psRes.status === 'fulfilled' ? psRes.value : null,
    security: siteData ? analyzeSecurityHeaders(siteData.headers) : null,
    domain: domRes.status === 'fulfilled' ? domRes.value : null,
    emailProvider: mxRes.status === 'fulfilled' ? mxRes.value : null,
    audit: siteData ? analyzeWebsiteHtml(siteData.html) : null,
  }

  return { ...intel, triggers: deriveSalesTriggers(intel) }
}
