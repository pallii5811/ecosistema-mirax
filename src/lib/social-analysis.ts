import 'server-only'

export async function analyzeSocialPresence(
  businessName: string,
  website: string,
  city: string
): Promise<{
  instagram: { handle: string | null; followers: number | null; lastPost: string | null; engagement: string | null; hasLink: boolean }
  facebook: { url: string | null; followers: number | null; lastPost: string | null; isActive: boolean }
  tiktok: { handle: string | null; followers: number | null; hasPresence: boolean }
  linkedin: { url: string | null; employees: number | null; hasPresence: boolean }
  overallScore: number
  missingPlatforms: string[]
  inactiveplatforms: string[]
  opportunities: string[]
}> {
  const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
  if (!apiKey) {
    return {
      instagram: { handle: null, followers: null, lastPost: null, engagement: null, hasLink: false },
      facebook: { url: null, followers: null, lastPost: null, isActive: false },
      tiktok: { handle: null, followers: null, hasPresence: false },
      linkedin: { url: null, employees: null, hasPresence: false },
      overallScore: 0,
      missingPlatforms: [],
      inactiveplatforms: [],
      opportunities: [],
    }
  }

  const prompt = `Sei un esperto di social media marketing.
Analizza la presenza social di questa azienda italiana:
Nome: ${businessName}
Sito: ${website}
Città: ${city}

Basandoti su queste informazioni, stima la probabile presenza social.
Rispondi SOLO con JSON valido:
{
  "instagram": {
    "handle": "handle o null",
    "followers": numero_stimato_o_null,
    "lastPost": "data stimata o null",
    "engagement": "alto/medio/basso o null",
    "hasLink": true/false
  },
  "facebook": {
    "url": "url o null",
    "followers": numero_o_null,
    "lastPost": "data stimata o null",
    "isActive": true/false
  },
  "tiktok": { "handle": "o null", "followers": null, "hasPresence": false },
  "linkedin": { "url": "o null", "employees": null, "hasPresence": false },
  "overallScore": 0-100,
  "missingPlatforms": ["piattaforme mancanti"],
  "inactiveplatforms": ["piattaforme inattive"],
  "opportunities": ["opportunità specifiche per consulente social"]
}
Solo JSON.`

  const res = await fetch('data:,mirax-legacy-provider-removed', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0,
    }),
  })

  const data = (await res.json()) as any
  const content = data?.choices?.[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

    const asStr = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const asNum = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const asBool = (v: any) => v === true
    const asStrArr = (v: any) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])

    return {
      instagram: {
        handle: asStr(parsed?.instagram?.handle),
        followers: asNum(parsed?.instagram?.followers),
        lastPost: asStr(parsed?.instagram?.lastPost),
        engagement: asStr(parsed?.instagram?.engagement),
        hasLink: asBool(parsed?.instagram?.hasLink),
      },
      facebook: {
        url: asStr(parsed?.facebook?.url),
        followers: asNum(parsed?.facebook?.followers),
        lastPost: asStr(parsed?.facebook?.lastPost),
        isActive: asBool(parsed?.facebook?.isActive),
      },
      tiktok: {
        handle: asStr(parsed?.tiktok?.handle),
        followers: asNum(parsed?.tiktok?.followers),
        hasPresence: asBool(parsed?.tiktok?.hasPresence),
      },
      linkedin: {
        url: asStr(parsed?.linkedin?.url),
        employees: asNum(parsed?.linkedin?.employees),
        hasPresence: asBool(parsed?.linkedin?.hasPresence),
      },
      overallScore: typeof parsed?.overallScore === 'number' && Number.isFinite(parsed.overallScore) ? Math.max(0, Math.min(100, parsed.overallScore)) : 0,
      missingPlatforms: asStrArr(parsed?.missingPlatforms),
      inactiveplatforms: asStrArr(parsed?.inactiveplatforms),
      opportunities: asStrArr(parsed?.opportunities),
    }
  } catch (e) {
    console.error('[SOCIAL]', e)
    return {
      instagram: { handle: null, followers: null, lastPost: null, engagement: null, hasLink: false },
      facebook: { url: null, followers: null, lastPost: null, isActive: false },
      tiktok: { handle: null, followers: null, hasPresence: false },
      linkedin: { url: null, employees: null, hasPresence: false },
      overallScore: 0,
      missingPlatforms: [],
      inactiveplatforms: [],
      opportunities: [],
    }
  }
}
