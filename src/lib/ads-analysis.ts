import 'server-only'

/**
 * Analisi pubblicitaria ONESTA ed evidence-first.
 *
 * Regole anti-bufala (per non bruciare la credibilità dell'agenzia col prospect):
 * - MAI budget inventati/hardcoded.
 * - MAI dichiarare "ads attive" come fatto se non è verificato da fonte ufficiale.
 * - I fatti certi sono solo: tag/pixel realmente rilevati sul sito (dallo scraper/audit)
 *   e l'eventuale conteggio inserzioni dalla Meta Ad Library API (solo se c'è il token).
 * - La prova sempre disponibile e a costo zero è il link pubblico alla Libreria Inserzioni Meta:
 *   l'agenzia clicca e verifica con i propri occhi.
 * - GPT è usato SOLO per spunti commerciali testuali, mai per inventare presenza ads o budget.
 */
export type AdsPresence = {
  facebookAds: {
    /** Meta Pixel realmente rilevato sul sito (fatto verificato dall'audit). */
    pixelOnSite: boolean
    /** Link pubblico alla Libreria Inserzioni Meta: prova verificabile in 1 click. */
    libraryUrl: string
    /** Verificato tramite API ufficiale Meta (richiede FB_ADS_TOKEN). */
    apiVerified: boolean
    /** Numero inserzioni attive trovate via API ufficiale; null = non verificabile qui. */
    activeAdsFound: number | null
  }
  googleAds: {
    /** Tag di conversione/remarketing Google Ads realmente rilevato sul sito (fatto verificato). */
    tagOnSite: boolean
  }
  /** Spunti commerciali generati da AI, da intendere come SUGGERIMENTI, non come dati. */
  opportunities: string[]
  competitorContext: string
}

export async function analyzeAdsPresence(
  businessName: string,
  website: string,
  city: string,
  category: string,
  evidence?: { metaPixelOnSite?: boolean; googleAdsTagOnSite?: boolean },
): Promise<AdsPresence> {
  const pixelOnSite = evidence?.metaPixelOnSite === true
  const googleAdsTagOnSite = evidence?.googleAdsTagOnSite === true

  // Libreria Inserzioni Meta — pubblica, ufficiale, verificabile senza token.
  const libraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IT&q=${encodeURIComponent(businessName)}`

  // Verifica opzionale via API ufficiale Meta (solo se è configurato il token).
  let apiVerified = false
  let activeAdsFound: number | null = null
  if (process.env.FB_ADS_TOKEN) {
    try {
      const fbApiUrl =
        `https://graph.facebook.com/v19.0/ads_archive?` +
        `access_token=${process.env.FB_ADS_TOKEN}` +
        `&search_terms=${encodeURIComponent(businessName)}` +
        `&ad_reached_countries=IT` +
        `&ad_active_status=ACTIVE` +
        `&fields=id,page_name,ad_delivery_start_time&limit=25`
      const fbRes = await fetch(fbApiUrl, { signal: AbortSignal.timeout(10000) })
      const fbData = (await fbRes.json()) as { data?: unknown[] }
      if (Array.isArray(fbData?.data)) {
        apiVerified = true
        activeAdsFound = fbData.data.length
      }
    } catch {
      apiVerified = false
      activeAdsFound = null
    }
  }

  // GPT: SOLO spunti commerciali testuali, basati sui fatti reali. Niente invenzione di ads/budget.
  const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
  let opportunities: string[] = []
  let competitorContext = ''

  if (apiKey) {
    try {
      const prompt = `Sei un consulente di digital advertising italiano.
FATTI VERIFICATI su questa azienda:
- Azienda: ${businessName}
- Settore: ${category}
- Città: ${city}
- Sito: ${website}
- Meta Pixel rilevato sul sito: ${pixelOnSite ? 'SÌ' : 'NO'}
- Tag Google Ads rilevato sul sito: ${googleAdsTagOnSite ? 'SÌ' : 'NO'}

Genera spunti commerciali concreti per un'agenzia che vuole vendere servizi ads/marketing a questa azienda.
REGOLE FERREE:
- NON affermare che l'azienda "sta facendo ads" o stima budget: non lo sappiamo con certezza.
- Basa gli spunti SOLO sui fatti sopra (presenza/assenza di pixel e tag).
- Niente numeri inventati.

Rispondi SOLO con JSON valido:
{
  "opportunities": ["spunto 1", "spunto 2", "spunto 3"],
  "competitorContext": "1 frase sul contesto competitivo del settore in questa città"
}`

      const res = await fetch('data:,mirax-legacy-provider-removed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 400,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(15000),
      })

      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const content = data?.choices?.[0]?.message?.content || '{}'
      const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim()) as {
        opportunities?: unknown
        competitorContext?: unknown
      }
      opportunities = Array.isArray(parsed?.opportunities)
        ? parsed.opportunities.filter((o): o is string => typeof o === 'string')
        : []
      competitorContext = typeof parsed?.competitorContext === 'string' ? parsed.competitorContext : ''
    } catch {
      opportunities = []
    }
  }

  return {
    facebookAds: {
      pixelOnSite,
      libraryUrl,
      apiVerified,
      activeAdsFound,
    },
    googleAds: {
      tagOnSite: googleAdsTagOnSite,
    },
    opportunities,
    competitorContext,
  }
}
