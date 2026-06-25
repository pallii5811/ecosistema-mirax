import { createClient } from '@/utils/supabase/server'

// GET /api/outreach/status — returns the user's recent outreach actions so the UI
// can show per-lead status, daily guardrail counts and monitoring stats.
// Degrades safely (enabled:false) when the outreach_log table is not yet migrated.

function isMissingTable(message: string | undefined): boolean {
  if (!message) return false
  return /outreach_log/i.test(message) && /(does not exist|relation|schema cache|could not find)/i.test(message)
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('outreach_log')
    .select('lead_website, lead_name, channel, status, mode, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(3000)

  if (error) {
    if (isMissingTable(error.message)) {
      return Response.json({ enabled: false, items: [], todayCount: 0, totalCount: 0 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  const items = data ?? []
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const todayMs = startOfToday.getTime()
  const thirtyDaysMs = todayMs - 29 * 86_400_000

  // Build last-7-days buckets (oldest → newest) for the trend sparkline.
  const dayKeys: string[] = []
  const dailyMap = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - i * 86_400_000)
    const key = d.toISOString().slice(0, 10)
    dayKeys.push(key)
    dailyMap.set(key, 0)
  }

  const channelCounts: Record<string, number> = {}
  const modeCounts: Record<string, number> = { sell_service: 0, mirax_promo: 0 }
  let todayCount = 0

  for (const row of items) {
    // Only real send events count towards activity metrics; outcome rows are excluded.
    if (row.status !== 'sent') continue
    const t = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN
    if (!Number.isFinite(t)) continue
    if (t >= todayMs) todayCount += 1

    const dayKey = new Date(t).toISOString().slice(0, 10)
    if (dailyMap.has(dayKey)) dailyMap.set(dayKey, (dailyMap.get(dayKey) || 0) + 1)

    if (t >= thirtyDaysMs) {
      const ch = typeof row.channel === 'string' ? row.channel : 'other'
      channelCounts[ch] = (channelCounts[ch] || 0) + 1
      const md = row.mode === 'mirax_promo' ? 'mirax_promo' : 'sell_service'
      modeCounts[md] = (modeCounts[md] || 0) + 1
    }
  }

  const daily = dayKeys.map((key) => ({ date: key, count: dailyMap.get(key) || 0 }))

  return Response.json({
    enabled: true,
    items,
    todayCount,
    totalCount: items.length,
    channelCounts,
    modeCounts,
    daily,
  })
}
