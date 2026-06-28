/**
 * Blocco 6 — pattern di chiusura (badge/segnali → conversione).
 */

export type PipelineRow = {
  lead_name?: string
  lead_website?: string | null
  lead_score?: number
  stage?: string
  updated_at?: string
  created_at?: string
  last_outreach_channel?: string | null
}

export type OutreachRow = {
  lead_name?: string | null
  lead_website?: string | null
  channel?: string
  status?: string
  created_at?: string
}

export type ClosurePattern = {
  signal: string
  label: string
  won: number
  lost: number
  baselineWinRate: number
  segmentWinRate: number
  liftPts: number
  confidence: number
}

function normalizeWebsite(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase().replace(/\/+$/, '')
  return trimmed || null
}

function canonicalKey(website: string | null | undefined, name: string | null | undefined): string | null {
  const web = normalizeWebsite(website)
  if (web) return `w:${web}`
  const nm = name ? name.trim().toLowerCase() : ''
  return nm ? `n:${nm}` : null
}

function keyFor(row: { lead_website?: string | null; lead_name?: string | null }): string | null {
  return canonicalKey(row.lead_website, row.lead_name)
}

function buildOutreachIndex(rows: OutreachRow[]) {
  const interested = new Set<string>()
  const channels = new Map<string, Set<string>>()
  const firstContact = new Map<string, number>()

  for (const row of rows) {
    const k = keyFor(row)
    if (!k) continue
    const st = String(row.status ?? '').toLowerCase()
    if (st === 'interested' || st === 'replied') interested.add(k)
    if (st === 'sent') {
      const ch = String(row.channel ?? 'other')
      const set = channels.get(k) ?? new Set<string>()
      set.add(ch)
      channels.set(k, set)
      const t = Date.parse(String(row.created_at ?? ''))
      if (Number.isFinite(t)) {
        const prev = firstContact.get(k)
        if (prev === undefined || t < prev) firstContact.set(k, t)
      }
    }
  }

  return { interested, channels, firstContact }
}

function winRate(won: number, lost: number): number {
  const d = won + lost
  return d > 0 ? Math.round((won / d) * 100) : 0
}

export function analyzeClosurePatterns(
  pipeline: PipelineRow[],
  outreach: OutreachRow[],
): ClosurePattern[] {
  const closed = pipeline.filter((p) => p.stage === 'vinto' || p.stage === 'perso')
  if (closed.length < 3) return []

  const wonTotal = closed.filter((p) => p.stage === 'vinto').length
  const lostTotal = closed.filter((p) => p.stage === 'perso').length
  const baseline = winRate(wonTotal, lostTotal)

  const idx = buildOutreachIndex(outreach)
  const patterns: ClosurePattern[] = []

  const evalSegment = (signal: string, label: string, match: (p: PipelineRow, k: string | null) => boolean) => {
    let won = 0
    let lost = 0
    for (const p of closed) {
      const k = keyFor(p)
      if (!match(p, k)) continue
      if (p.stage === 'vinto') won++
      else lost++
    }
    const n = won + lost
    if (n < 2) return
    const seg = winRate(won, lost)
    patterns.push({
      signal,
      label,
      won,
      lost,
      baselineWinRate: baseline,
      segmentWinRate: seg,
      liftPts: seg - baseline,
      confidence: Math.min(0.95, 0.45 + n * 0.08),
    })
  }

  evalSegment('score_hot', 'Score pipeline ≥ 70', (p) => Number(p.lead_score) >= 70)
  evalSegment('score_warm', 'Score pipeline 50–69', (p) => {
    const s = Number(p.lead_score)
    return s >= 50 && s < 70
  })
  evalSegment('outreach_interested', 'Esito outreach: interessato', (_p, k) => !!k && idx.interested.has(k))
  evalSegment('channel_whatsapp', 'Primo contatto WhatsApp', (_p, k) => !!k && !!idx.channels.get(k)?.has('whatsapp'))
  evalSegment('channel_email', 'Primo contatto Email', (_p, k) => !!k && !!idx.channels.get(k)?.has('email'))
  evalSegment('fast_close', 'Chiusura entro 14 giorni dal contatto', (p, k) => {
    if (!k) return false
    const first = idx.firstContact.get(k)
    const end = Date.parse(String(p.updated_at ?? p.created_at ?? ''))
    if (!Number.isFinite(first) || !Number.isFinite(end)) return false
    return end - (first as number) <= 14 * 86_400_000
  })

  return patterns.sort((a, b) => b.liftPts - a.liftPts).slice(0, 8)
}
