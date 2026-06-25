import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// ── Helpers ──────────────────────────────────────────────────────

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || ''

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
}

async function fetchHtml(url: string, timeout = 8000): Promise<string> {
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeout), redirect: 'follow' })
    if (!r.ok) return ''
    return await r.text()
  } catch { return '' }
}

// ── Extract social links from website HTML ───────────────────────

interface SocialLinks {
  instagram?: string
  tiktok?: string
  facebook?: string
  linkedin?: string
  youtube?: string
}

function extractSocialLinks(html: string): SocialLinks {
  const links: SocialLinks = {}
  // Instagram
  const ig = html.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+))\/?["']/i)
  if (ig && ig[2] && !['p', 'explore', 'reel', 'stories', 'accounts'].includes(ig[2].toLowerCase())) {
    links.instagram = ig[2].replace(/\/+$/, '')
  }
  // TikTok
  const tt = html.match(/href=["'](https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.]+))\/?["']/i)
  if (tt && tt[2]) links.tiktok = tt[2].replace(/\/+$/, '')
  // Facebook
  const fb = html.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9_./-]+))["']/i)
  if (fb && fb[2] && !['sharer', 'share', 'dialog', 'plugins'].includes(fb[2].split('/')[0].toLowerCase())) {
    links.facebook = `https://facebook.com/${fb[2].replace(/\/+$/, '')}`
  }
  // LinkedIn
  const li = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+))\/?["']/i)
  if (li) links.linkedin = li[1]
  // YouTube
  const yt = html.match(/href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9_-]+))\/?["']/i)
  if (yt) links.youtube = yt[1]
  return links
}

// ── Detect pixels & tech stack from website HTML ─────────────────

interface TechDetection {
  tiktok_pixel: boolean
  meta_pixel: boolean
  google_analytics: boolean
  google_tag_manager: boolean
  google_ads: boolean
  hotjar: boolean
  microsoft_clarity: boolean
  hubspot: boolean
  mailchimp: boolean
  cms?: string
  has_ssl?: boolean
  has_cookie_banner: boolean
  has_privacy_policy: boolean
  has_ecommerce: boolean
}

function detectTech(html: string, url: string): TechDetection {
  const h = html.toLowerCase()
  return {
    tiktok_pixel: h.includes('ttq.load') || h.includes('analytics.tiktok.com'),
    meta_pixel: h.includes("fbq('init") || h.includes('fbq("init') || h.includes('connect.facebook.net/en_US/fbevents'),
    google_analytics: h.includes('gtag(') || h.includes('google-analytics.com') || h.includes('googletagmanager.com/gtag'),
    google_tag_manager: h.includes('googletagmanager.com/gtm') || h.includes('gtm.start'),
    google_ads: h.includes('googleads.') || h.includes('googlesyndication.') || h.includes("gtag('config', 'AW-"),
    hotjar: h.includes('hotjar.com') || h.includes('hj('),
    microsoft_clarity: h.includes('clarity.ms'),
    hubspot: h.includes('hubspot.com') || h.includes('hs-scripts.com') || h.includes('hbspt.'),
    mailchimp: h.includes('mailchimp.com') || h.includes('list-manage.com') || h.includes('mc.us'),
    cms: detectCms(h),
    has_ssl: url.startsWith('https'),
    has_cookie_banner: h.includes('cookie') && (h.includes('consent') || h.includes('banner') || h.includes('accett') || h.includes('gdpr')),
    has_privacy_policy: h.includes('privacy') && (h.includes('policy') || h.includes('informativa')),
    has_ecommerce: h.includes('add-to-cart') || h.includes('addtocart') || h.includes('woocommerce') || h.includes('shopify') || h.includes('prestashop') || h.includes('/cart') || h.includes('carrello'),
  }
}

function detectCms(h: string): string | undefined {
  if (h.includes('wp-content') || h.includes('wp-includes') || h.includes('wordpress')) return 'WordPress'
  if (h.includes('shopify.com') || h.includes('cdn.shopify')) return 'Shopify'
  if (h.includes('squarespace.com') || h.includes('squarespace-cdn')) return 'Squarespace'
  if (h.includes('wix.com') || h.includes('wixsite') || h.includes('parastorage.com')) return 'Wix'
  if (h.includes('webflow.com') || h.includes('assets.website-files')) return 'Webflow'
  if (h.includes('prestashop') || h.includes('presta')) return 'PrestaShop'
  if (h.includes('joomla')) return 'Joomla'
  if (h.includes('drupal')) return 'Drupal'
  return undefined
}

// ── Instagram public profile scraping ────────────────────────────

interface InstagramData {
  username: string
  full_name?: string
  biography?: string
  followers?: number
  following?: number
  posts_count?: number
  is_verified?: boolean
  is_business?: boolean
  profile_pic?: string
  external_url?: string
  engagement_rate?: number
  avg_likes?: number
  avg_comments?: number
  last_post_date?: string
  last_post_days_ago?: number
  posting_frequency?: string
  category?: string
  error?: string
}

function calcEngagement(posts: any[], followers: number): Partial<InstagramData> {
  if (!posts || posts.length === 0 || !followers) return {}
  let totalLikes = 0, totalComments = 0
  let latestTs = 0
  const validPosts: number[] = []
  for (const p of posts.slice(0, 12)) {
    const node = p.node || p
    const likes = node.edge_liked_by?.count ?? node.like_count ?? node.likes ?? 0
    const comments = node.edge_media_to_comment?.count ?? node.comment_count ?? node.comments ?? 0
    totalLikes += likes
    totalComments += comments
    const ts = node.taken_at_timestamp ?? node.taken_at ?? 0
    if (ts > latestTs) latestTs = ts
    if (ts) validPosts.push(ts)
  }
  const count = posts.slice(0, 12).length
  const avgLikes = Math.round(totalLikes / count)
  const avgComments = Math.round(totalComments / count)
  const engRate = parseFloat(((totalLikes + totalComments) / count / followers * 100).toFixed(2))
  const result: Partial<InstagramData> = { engagement_rate: engRate, avg_likes: avgLikes, avg_comments: avgComments }
  if (latestTs > 0) {
    const d = new Date(latestTs * 1000)
    result.last_post_date = d.toISOString().split('T')[0]
    result.last_post_days_ago = Math.round((Date.now() - d.getTime()) / 86400000)
  }
  if (validPosts.length >= 2) {
    validPosts.sort((a, b) => b - a)
    const spanDays = (validPosts[0] - validPosts[validPosts.length - 1]) / 86400
    if (spanDays > 0) {
      const postsPerWeek = (validPosts.length / spanDays) * 7
      if (postsPerWeek >= 7) result.posting_frequency = `${Math.round(postsPerWeek / 7)}/giorno`
      else if (postsPerWeek >= 1) result.posting_frequency = `${Math.round(postsPerWeek)}/settimana`
      else result.posting_frequency = `${Math.round(postsPerWeek * 4.3)}/mese`
    }
  }
  return result
}

async function scrapeInstagram(username: string): Promise<InstagramData | null> {
  if (!username) return null

  // ── Method 1: RapidAPI Instagram Scraper (most reliable) ────────
  if (RAPIDAPI_KEY) {
    try {
      const res = await fetch(
        `https://instagram-scraper-api2.p.rapidapi.com/v1/info?username_or_id_or_url=${encodeURIComponent(username)}`,
        {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'instagram-scraper-api2.p.rapidapi.com',
          },
          signal: AbortSignal.timeout(10000),
        }
      )
      if (res.ok) {
        const json = (await res.json()) as any
        const d = json?.data || json
        if (d && (d.follower_count !== undefined || d.edge_followed_by)) {
          const followers = d.follower_count ?? d.edge_followed_by?.count ?? 0
          const result: InstagramData = {
            username: d.username || username,
            full_name: d.full_name || undefined,
            biography: d.biography || undefined,
            followers,
            following: d.following_count ?? d.edge_follow?.count,
            posts_count: d.media_count ?? d.edge_owner_to_timeline_media?.count,
            is_verified: d.is_verified,
            is_business: d.is_business_account || d.is_professional_account,
            profile_pic: d.profile_pic_url_hd || d.hd_profile_pic_url_info?.url || d.profile_pic_url,
            external_url: d.external_url || d.bio_links?.[0]?.url || undefined,
            category: d.category_name || d.category || undefined,
          }
          // Try to get recent posts for engagement
          const posts = d.edge_owner_to_timeline_media?.edges || d.items || []
          if (posts.length > 0 && followers > 0) {
            Object.assign(result, calcEngagement(posts, followers))
          }
          // If no posts in profile response, try posts endpoint
          if (!result.engagement_rate && followers > 0) {
            try {
              const postsRes = await fetch(
                `https://instagram-scraper-api2.p.rapidapi.com/v1.2/posts?username_or_id_or_url=${encodeURIComponent(username)}`,
                {
                  headers: {
                    'X-RapidAPI-Key': RAPIDAPI_KEY,
                    'X-RapidAPI-Host': 'instagram-scraper-api2.p.rapidapi.com',
                  },
                  signal: AbortSignal.timeout(10000),
                }
              )
              if (postsRes.ok) {
                const postsJson = (await postsRes.json()) as any
                const items = postsJson?.data?.items || postsJson?.items || postsJson?.data?.edges || []
                if (items.length > 0) Object.assign(result, calcEngagement(items, followers))
              }
            } catch { /* posts fetch failed, ok */ }
          }
          return result
        }
      }
    } catch { /* RapidAPI failed, try fallbacks */ }
  }

  // ── Method 2: Instagram web API (often rate-limited) ────────────
  try {
    const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
      headers: {
        ...BROWSER_HEADERS,
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const json = (await res.json()) as any
      const u = json?.data?.user
      if (u) {
        const followers = u.edge_followed_by?.count ?? u.follower_count ?? 0
        const result: InstagramData = {
          username,
          full_name: u.full_name || undefined,
          biography: u.biography || undefined,
          followers,
          following: u.edge_follow?.count ?? u.following_count,
          posts_count: u.edge_owner_to_timeline_media?.count ?? u.media_count,
          is_verified: u.is_verified,
          is_business: u.is_business_account || u.is_professional_account,
          profile_pic: u.profile_pic_url_hd || u.profile_pic_url,
          external_url: u.external_url || undefined,
          category: u.category_name || undefined,
        }
        const posts = u.edge_owner_to_timeline_media?.edges || []
        if (posts.length > 0 && followers > 0) {
          Object.assign(result, calcEngagement(posts, followers))
        }
        return result
      }
    }
  } catch { /* try fallback */ }

  // ── Method 3: HTML meta tags (last resort) ─────────────────────
  try {
    const html = await fetchHtml(`https://www.instagram.com/${username}/`, 8000)
    if (!html || html.length < 1000) return { username, error: 'profilo_non_accessibile' }

    const result: InstagramData = { username }

    const descM = html.match(/meta\s+(?:name|property)=["'](?:og:)?description["']\s+content=["']([^"']+)/i)
    if (descM) {
      const desc = descM[1]
      const fol = desc.match(/([\d,.]+[KkMm]?)\s*Follower/i)
      if (fol) result.followers = parseCount(fol[1])
      const fing = desc.match(/([\d,.]+[KkMm]?)\s*Following/i)
      if (fing) result.following = parseCount(fing[1])
      const posts = desc.match(/([\d,.]+[KkMm]?)\s*Post/i)
      if (posts) result.posts_count = parseCount(posts[1])
    }

    const titleM = html.match(/<title>([^<]+)/i)
    if (titleM) {
      const nameM = titleM[1].match(/^(.+?)\s*[\((@]/)
      if (nameM) result.full_name = nameM[1].trim()
    }

    if (html.includes('"is_verified":true')) result.is_verified = true

    return result.followers !== undefined ? result : { username, error: 'dati_limitati' }
  } catch { return { username, error: 'errore_scraping' } }
}

function parseCount(s: string): number {
  if (!s) return 0
  const clean = s.replace(/,/g, '').trim()
  const num = parseFloat(clean)
  if (clean.toLowerCase().endsWith('k')) return Math.round(num * 1000)
  if (clean.toLowerCase().endsWith('m')) return Math.round(num * 1000000)
  return Math.round(num)
}

// ── TikTok public profile scraping ───────────────────────────────

interface TikTokData {
  username: string
  nickname?: string
  bio?: string
  followers?: number
  following?: number
  likes?: number
  video_count?: number
  is_verified?: boolean
  profile_pic?: string
  error?: string
}

async function scrapeTikTok(username: string): Promise<TikTokData | null> {
  if (!username) return null
  try {
    const html = await fetchHtml(`https://www.tiktok.com/@${username}`, 10000)
    if (!html || html.length < 1000) return { username, error: 'profilo_non_accessibile' }

    const result: TikTokData = { username }

    // Extract from __UNIVERSAL_DATA_FOR_REHYDRATION__
    const jsonM = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i)
    if (jsonM) {
      try {
        const data = JSON.parse(jsonM[1]) as any
        const userInfo = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo
        const u = userInfo?.user
        const stats = userInfo?.stats

        if (u) {
          result.nickname = u.nickname
          result.bio = u.signature
          result.is_verified = u.verified
          result.profile_pic = u.avatarLarger || u.avatarMedium
        }
        if (stats) {
          result.followers = stats.followerCount
          result.following = stats.followingCount
          result.likes = stats.heartCount || stats.heart
          result.video_count = stats.videoCount
        }
      } catch { /* JSON parse failed */ }
    }

    // Fallback: SIGI_STATE (newer TikTok format)
    if (result.followers === undefined) {
      const sigiM = html.match(/<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i)
      if (sigiM) {
        try {
          const sigi = JSON.parse(sigiM[1]) as any
          const users = sigi?.UserModule?.users || {}
          const stats = sigi?.UserModule?.stats || {}
          const uid = Object.keys(users)[0]
          if (uid && users[uid]) {
            result.nickname = users[uid].nickname
            result.bio = users[uid].signature
            result.is_verified = users[uid].verified
            result.profile_pic = users[uid].avatarLarger
          }
          if (uid && stats[uid]) {
            result.followers = stats[uid].followerCount
            result.following = stats[uid].followingCount
            result.likes = stats[uid].heartCount || stats[uid].heart
            result.video_count = stats[uid].videoCount
          }
        } catch { /* ignore */ }
      }
    }

    // Fallback: meta tags
    if (result.followers === undefined) {
      const descM = html.match(/meta\s+(?:name|property)=["'](?:og:)?description["']\s+content=["']([^"']+)/i)
      if (descM) {
        const desc = descM[1]
        const fol = desc.match(/([\d,.]+[KkMm]?)\s*Follower/i)
        if (fol) result.followers = parseCount(fol[1])
        const likes = desc.match(/([\d,.]+[KkMm]?)\s*(?:Like|Mi piace)/i)
        if (likes) result.likes = parseCount(likes[1])
      }
    }

    return result.followers !== undefined ? result : { username, error: 'dati_limitati' }
  } catch { return { username, error: 'errore_scraping' } }
}

// ── Format numbers for display ───────────────────────────────────

function formatNumber(n: number | undefined): string | undefined {
  if (n === undefined || n === null) return undefined
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  if (n >= 1000) return new Intl.NumberFormat('it-IT').format(n)
  return String(n)
}

// ── Website Quality Analysis (FREE - analyzes already-fetched HTML) ──

interface WebsiteScore {
  score: number          // 0-100
  has_meta_description: boolean
  has_og_tags: boolean
  has_favicon: boolean
  has_viewport: boolean  // mobile-friendly
  has_h1: boolean
  has_structured_data: boolean
  has_sitemap_link: boolean
  has_robots: boolean
  has_contact_form: boolean
  has_chat_widget: boolean
  has_blog: boolean
  has_newsletter: boolean
  has_phone_visible: boolean
  has_email_visible: boolean
  has_maps_embed: boolean
  page_size_kb: number
  external_scripts_count: number
  image_count: number
  issues: string[]
  strengths: string[]
}

function analyzeWebsite(html: string, url: string): WebsiteScore {
  const h = html.toLowerCase()
  const has_meta_description = /meta\s+name=["']description/i.test(html) && !/content=["']\s*["']/i.test(html.match(/meta\s+name=["']description["'][^>]*>/i)?.[0] || '')
  const has_og_tags = h.includes('property="og:') || h.includes("property='og:")
  const has_favicon = h.includes('rel="icon"') || h.includes("rel='icon'") || h.includes('rel="shortcut icon"') || h.includes('favicon')
  const has_viewport = h.includes('name="viewport"') || h.includes("name='viewport'")
  const has_h1 = /<h1[\s>]/i.test(html)
  const has_structured_data = h.includes('application/ld+json') || h.includes('itemtype="http')
  const has_sitemap_link = h.includes('sitemap')
  const has_robots = h.includes('name="robots"')
  const has_contact_form = h.includes('<form') && (h.includes('email') || h.includes('contatt') || h.includes('contact') || h.includes('message') || h.includes('messaggio'))
  const has_chat_widget = h.includes('tawk.to') || h.includes('crisp.chat') || h.includes('intercom') || h.includes('livechat') || h.includes('tidio') || h.includes('drift.com') || h.includes('zendesk') || h.includes('whatsapp') || h.includes('wa.me/')
  const has_blog = h.includes('/blog') || h.includes('/news') || h.includes('/articol') || h.includes('/magazine')
  const has_newsletter = h.includes('newsletter') || h.includes('iscriviti') || h.includes('subscribe') || h.includes('mailing')
  const has_phone_visible = /(\+39|0[0-9]{1,4}[\s.-]?[0-9]{4,10}|tel:)/i.test(html)
  const has_email_visible = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(html) && !h.includes('noreply@') && !h.includes('example@')
  const has_maps_embed = h.includes('google.com/maps') || h.includes('maps.google') || h.includes('openstreetmap')
  const page_size_kb = Math.round(html.length / 1024)
  const external_scripts_count = (html.match(/<script[^>]+src=["']https?:\/\//gi) || []).length
  const image_count = (html.match(/<img[\s]/gi) || []).length

  // Calculate score
  let score = 0
  const checks: [boolean, number][] = [
    [has_meta_description, 8], [has_og_tags, 6], [has_favicon, 4], [has_viewport, 10],
    [has_h1, 6], [has_structured_data, 7], [has_contact_form, 8], [has_chat_widget, 5],
    [has_blog, 5], [has_newsletter, 5], [has_phone_visible, 6], [has_email_visible, 6],
    [has_maps_embed, 4], [url.startsWith('https'), 10], [has_sitemap_link, 3],
    [has_robots, 2], [page_size_kb < 500, 5],
  ]
  for (const [check, pts] of checks) if (check) score += pts

  const issues: string[] = []
  const strengths: string[] = []
  if (!has_meta_description) issues.push('Manca meta description (SEO)')
  if (!has_viewport) issues.push('Non ottimizzato per mobile')
  if (!has_og_tags) issues.push('Manca Open Graph (anteprima social scarsa)')
  if (!has_h1) issues.push('Manca tag H1 (SEO)')
  if (!url.startsWith('https')) issues.push('Nessun HTTPS (sicurezza)')
  if (!has_contact_form) issues.push('Nessun form di contatto')
  if (!has_structured_data) issues.push('Nessun dato strutturato (Schema.org)')
  if (!has_phone_visible) issues.push('Telefono non visibile')
  if (!has_chat_widget) issues.push('Nessuna live chat')
  if (!has_newsletter) issues.push('Nessuna newsletter')
  if (!has_blog) issues.push('Nessun blog/news')
  if (page_size_kb > 500) issues.push(`Pagina pesante (${page_size_kb}KB)`)

  if (has_viewport) strengths.push('Mobile-friendly')
  if (url.startsWith('https')) strengths.push('HTTPS attivo')
  if (has_meta_description) strengths.push('SEO base presente')
  if (has_structured_data) strengths.push('Dati strutturati')
  if (has_contact_form) strengths.push('Form contatto')
  if (has_chat_widget) strengths.push('Live chat attiva')
  if (has_blog) strengths.push('Blog/News attivo')
  if (has_newsletter) strengths.push('Newsletter attiva')
  if (has_og_tags) strengths.push('Open Graph configurato')
  if (has_maps_embed) strengths.push('Mappa integrata')

  return {
    score, has_meta_description, has_og_tags, has_favicon, has_viewport, has_h1,
    has_structured_data, has_sitemap_link, has_robots, has_contact_form, has_chat_widget,
    has_blog, has_newsletter, has_phone_visible, has_email_visible, has_maps_embed,
    page_size_kb, external_scripts_count, image_count, issues, strengths,
  }
}

// ── LinkedIn OG data (FREE - public meta tags) ──────────────────

interface LinkedInData {
  url: string
  company_name?: string
  description?: string
  followers?: number
  followers_display?: string
  industry?: string
  logo?: string
  error?: string
}

async function scrapeLinkedIn(url: string): Promise<LinkedInData | null> {
  if (!url) return null
  try {
    const html = await fetchHtml(url, 8000)
    if (!html || html.length < 500) return { url, error: 'non_accessibile' }
    const result: LinkedInData = { url }
    // OG tags
    const ogTitle = html.match(/property=["']og:title["']\s+content=["']([^"']+)/i)
    if (ogTitle) result.company_name = ogTitle[1].replace(/\s*\|.*$/, '').replace(/\s*[-–].*LinkedIn.*$/i, '').trim()
    const ogDesc = html.match(/property=["']og:description["']\s+content=["']([^"']+)/i)
    if (ogDesc) {
      result.description = ogDesc[1].substring(0, 200)
      // "Company Name | X,XXX followers on LinkedIn..."
      const folM = ogDesc[1].match(/([\d,.]+[KkMm]?)\s*follower/i)
      if (folM) {
        result.followers = parseCount(folM[1])
        result.followers_display = formatNumber(result.followers)
      }
      // Try extracting industry
      const indM = ogDesc[1].match(/(?:industry|settore)[:\s]*([^.|,]+)/i)
      if (indM) result.industry = indM[1].trim()
    }
    const ogImg = html.match(/property=["']og:image["']\s+content=["']([^"']+)/i)
    if (ogImg) result.logo = ogImg[1]
    // Title fallback for followers
    if (!result.followers) {
      const titleM = html.match(/<title>([^<]+)/i)
      if (titleM) {
        const folM = titleM[1].match(/([\d,.]+[KkMm]?)\s*follower/i)
        if (folM) {
          result.followers = parseCount(folM[1])
          result.followers_display = formatNumber(result.followers)
        }
      }
    }
    return result
  } catch { return { url, error: 'errore_scraping' } }
}

// ── Facebook page data (FREE - public OG tags) ─────────────────

interface FacebookData {
  url: string
  page_name?: string
  description?: string
  likes?: number
  likes_display?: string
  category?: string
  logo?: string
  error?: string
}

async function scrapeFacebook(url: string): Promise<FacebookData | null> {
  if (!url) return null
  try {
    const html = await fetchHtml(url, 8000)
    if (!html || html.length < 500) return { url, error: 'non_accessibile' }
    const result: FacebookData = { url }
    const ogTitle = html.match(/property=["']og:title["']\s+content=["']([^"']+)/i)
    if (ogTitle) result.page_name = ogTitle[1].trim()
    const ogDesc = html.match(/property=["']og:description["']\s+content=["']([^"']+)/i)
    if (ogDesc) {
      result.description = ogDesc[1].substring(0, 200)
      // "X,XXX likes · Y talking about this"
      const likesM = ogDesc[1].match(/([\d,.]+[KkMm]?)\s*(?:likes?|piace|mi piace)/i)
      if (likesM) {
        result.likes = parseCount(likesM[1])
        result.likes_display = formatNumber(result.likes)
      }
    }
    const ogImg = html.match(/property=["']og:image["']\s+content=["']([^"']+)/i)
    if (ogImg) result.logo = ogImg[1]
    // Try meta keywords for category
    const metaKw = html.match(/name=["']keywords["']\s+content=["']([^"']+)/i)
    if (metaKw) result.category = metaKw[1].split(',')[0]?.trim()
    return result
  } catch { return { url, error: 'errore_scraping' } }
}

// ── Wayback Machine domain age (FREE) ───────────────────────────

interface DomainInfo {
  domain: string
  first_seen?: string
  domain_age_years?: number
  snapshots?: number
}

async function getDomainAge(domain: string): Promise<DomainInfo | null> {
  if (!domain) return null
  try {
    const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    const res = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${clean}&output=json&limit=1&fl=timestamp&from=19960101`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return { domain: clean }
    const json = await res.json()
    if (!Array.isArray(json) || json.length < 2) return { domain: clean }
    const ts = json[1]?.[0]
    if (!ts || typeof ts !== 'string') return { domain: clean }
    const year = parseInt(ts.substring(0, 4))
    const month = parseInt(ts.substring(4, 6))
    const day = parseInt(ts.substring(6, 8))
    const firstDate = new Date(year, month - 1, day)
    const ageYears = parseFloat(((Date.now() - firstDate.getTime()) / (365.25 * 86400000)).toFixed(1))

    // Also get total snapshots count
    let snapshots: number | undefined
    try {
      const countRes = await fetch(
        `https://web.archive.org/cdx/search/cdx?url=${clean}&output=json&limit=0&showNumPages=true`,
        { signal: AbortSignal.timeout(4000) }
      )
      if (countRes.ok) {
        const countText = await countRes.text()
        const n = parseInt(countText)
        if (!isNaN(n)) snapshots = n
      }
    } catch { /* ok */ }

    return {
      domain: clean,
      first_seen: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      domain_age_years: ageYears,
      snapshots,
    }
  } catch { return { domain } }
}

// ── Digital Maturity Score (aggregate) ──────────────────────────

interface DigitalScore {
  score: number           // 0-100
  level: string           // 'Eccellente' | 'Buono' | 'Nella media' | 'Da migliorare' | 'Critico'
  color: string           // for frontend badge
  breakdown: { area: string; score: number; max: number }[]
  opportunities: string[]
}

function computeDigitalScore(
  websiteScore: WebsiteScore | null,
  tech: TechDetection | null,
  ig: InstagramData | null,
  tt: TikTokData | null,
  li: LinkedInData | null,
  fb: FacebookData | null,
  domainInfo: DomainInfo | null,
): DigitalScore {
  const breakdown: { area: string; score: number; max: number }[] = []
  const opportunities: string[] = []
  let total = 0, maxTotal = 0

  // 1. Website quality (max 25)
  const webPts = websiteScore ? Math.round(websiteScore.score * 25 / 100) : 0
  breakdown.push({ area: 'Sito Web', score: webPts, max: 25 })
  total += webPts; maxTotal += 25
  if (!websiteScore || websiteScore.score < 50) opportunities.push('Migliorare qualità sito web (SEO, mobile, form)')

  // 2. Social presence (max 25)
  let socialPts = 0
  if (ig && ig.followers) socialPts += Math.min(10, Math.round(Math.log10(ig.followers + 1) * 2))
  if (tt && tt.followers) socialPts += Math.min(5, Math.round(Math.log10(tt.followers + 1) * 1.2))
  if (li && li.followers) socialPts += Math.min(5, Math.round(Math.log10(li.followers + 1) * 1.5))
  if (fb && fb.likes) socialPts += Math.min(5, Math.round(Math.log10(fb.likes + 1) * 1.2))
  socialPts = Math.min(25, socialPts)
  breakdown.push({ area: 'Presenza Social', score: socialPts, max: 25 })
  total += socialPts; maxTotal += 25
  if (!ig && !tt) opportunities.push('Aprire profili social (Instagram, TikTok)')
  else if (ig && !ig.followers) opportunities.push('Aumentare follower Instagram')
  if (ig && ig.engagement_rate !== undefined && ig.engagement_rate < 1) opportunities.push('Migliorare engagement Instagram (< 1%)')
  if (ig && ig.last_post_days_ago !== undefined && ig.last_post_days_ago > 30) opportunities.push('Riprendere a postare su Instagram (ultimo post > 30 giorni fa)')
  if (!li) opportunities.push('Creare pagina LinkedIn aziendale')

  // 3. Marketing & Ads (max 25)
  let mktPts = 0
  if (tech) {
    if (tech.meta_pixel) mktPts += 5
    if (tech.google_analytics || tech.google_tag_manager) mktPts += 5
    if (tech.google_ads) mktPts += 4
    if (tech.tiktok_pixel) mktPts += 3
    if (tech.hotjar || tech.microsoft_clarity) mktPts += 3
    if (tech.hubspot) mktPts += 3
    if (tech.mailchimp) mktPts += 2
  }
  mktPts = Math.min(25, mktPts)
  breakdown.push({ area: 'Marketing Digitale', score: mktPts, max: 25 })
  total += mktPts; maxTotal += 25
  if (!tech?.meta_pixel && !tech?.google_ads) opportunities.push('Attivare campagne Ads (Meta/Google)')
  if (!tech?.google_analytics && !tech?.google_tag_manager) opportunities.push('Installare Google Analytics/Tag Manager')
  if (!tech?.hotjar && !tech?.microsoft_clarity) opportunities.push('Aggiungere heatmap (Hotjar/Clarity)')
  if (!tech?.mailchimp && !tech?.hubspot) opportunities.push('Implementare email marketing')

  // 4. Domain maturity (max 15)
  let domPts = 0
  if (domainInfo?.domain_age_years) {
    domPts = Math.min(10, Math.round(domainInfo.domain_age_years * 1.5))
  }
  if (tech?.has_ssl) domPts += 3
  if (tech?.has_cookie_banner) domPts += 1
  if (tech?.has_privacy_policy) domPts += 1
  domPts = Math.min(15, domPts)
  breakdown.push({ area: 'Maturità Dominio', score: domPts, max: 15 })
  total += domPts; maxTotal += 15
  if (!tech?.has_cookie_banner) opportunities.push('Aggiungere cookie banner (GDPR)')
  if (!tech?.has_privacy_policy) opportunities.push('Aggiungere privacy policy')

  // 5. E-commerce (max 10)
  let ecPts = 0
  if (tech?.has_ecommerce) ecPts += 10
  breakdown.push({ area: 'E-commerce', score: ecPts, max: 10 })
  total += ecPts; maxTotal += 10

  const score = maxTotal > 0 ? Math.round(total / maxTotal * 100) : 0
  let level: string, color: string
  if (score >= 80) { level = 'Eccellente'; color = 'emerald' }
  else if (score >= 60) { level = 'Buono'; color = 'blue' }
  else if (score >= 40) { level = 'Nella media'; color = 'amber' }
  else if (score >= 20) { level = 'Da migliorare'; color = 'orange' }
  else { level = 'Critico'; color = 'red' }

  return { score, level, color, breakdown, opportunities: opportunities.slice(0, 8) }
}

// ── Main route ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { lead } = body

  const website = lead?.sito || lead?.website || ''

  const response: Record<string, any> = {
    social_links: {},
    tech: null,
    instagram: null,
    tiktok: null,
    linkedin: null,
    facebook: null,
    website_score: null,
    domain_info: null,
    digital_score: null,
  }

  // Step 1: Fetch website HTML → extract social links + detect tech + analyze quality
  let siteHtml = ''
  let siteUrl = ''
  if (website) {
    siteUrl = website.startsWith('http') ? website : `https://${website}`
    siteHtml = await fetchHtml(siteUrl)
  }

  let tech: TechDetection | null = null
  let websiteScore: WebsiteScore | null = null

  if (siteHtml) {
    response.social_links = extractSocialLinks(siteHtml)
    tech = detectTech(siteHtml, siteUrl)
    response.tech = tech
    websiteScore = analyzeWebsite(siteHtml, siteUrl)
    response.website_score = websiteScore
  }

  // Use social links from lead data if not found in HTML
  const igUsername = response.social_links.instagram
    || extractUsernameFromUrl(lead?.instagram, 'instagram.com')
  const ttUsername = response.social_links.tiktok
    || extractUsernameFromUrl(lead?.tiktok, 'tiktok.com/@')
  const liUrl = response.social_links.linkedin || lead?.linkedin || null
  const fbUrl = response.social_links.facebook || lead?.facebook || null

  // Step 2: Scrape ALL social + domain data IN PARALLEL
  const [igData, ttData, liData, fbData, domainInfo] = await Promise.all([
    igUsername ? scrapeInstagram(igUsername) : Promise.resolve(null),
    ttUsername ? scrapeTikTok(ttUsername) : Promise.resolve(null),
    liUrl ? scrapeLinkedIn(liUrl) : Promise.resolve(null),
    fbUrl ? scrapeFacebook(fbUrl) : Promise.resolve(null),
    siteUrl ? getDomainAge(siteUrl) : Promise.resolve(null),
  ])

  if (igData) {
    response.instagram = {
      ...igData,
      followers_display: formatNumber(igData.followers),
      following_display: formatNumber(igData.following),
      posts_display: formatNumber(igData.posts_count),
      avg_likes_display: formatNumber(igData.avg_likes),
      avg_comments_display: formatNumber(igData.avg_comments),
      engagement_display: igData.engagement_rate !== undefined ? `${igData.engagement_rate}%` : undefined,
      url: `https://instagram.com/${igData.username}`,
    }
  }

  if (ttData) {
    response.tiktok = {
      ...ttData,
      followers_display: formatNumber(ttData.followers),
      following_display: formatNumber(ttData.following),
      likes_display: formatNumber(ttData.likes),
      video_count_display: formatNumber(ttData.video_count),
      url: `https://tiktok.com/@${ttData.username}`,
    }
  }

  if (liData) response.linkedin = liData
  if (fbData) response.facebook = fbData
  if (domainInfo) response.domain_info = domainInfo

  // Step 3: Compute Digital Maturity Score
  response.digital_score = computeDigitalScore(websiteScore, tech, igData, ttData, liData, fbData, domainInfo)

  return NextResponse.json(response)
}

function extractUsernameFromUrl(url: string | undefined, domain: string): string | null {
  if (!url) return null
  try {
    const match = url.match(new RegExp(domain.replace('.', '\\.') + '\\/?@?([a-zA-Z0-9_.]+)', 'i'))
    return match?.[1] || null
  } catch { return null }
}
