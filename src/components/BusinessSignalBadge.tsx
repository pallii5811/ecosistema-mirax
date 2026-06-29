'use client'

import { Briefcase, Gauge, TrendingUp } from 'lucide-react'
import type { MiraxSignal } from '@/lib/mirax-signals'

type Props = {
  signals: MiraxSignal[]
  compact?: boolean
}

const TONE: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-800 border-rose-200',
  high: 'bg-violet-100 text-violet-800 border-violet-200',
  medium: 'bg-sky-50 text-sky-700 border-sky-200',
  low: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  unknown: 'bg-zinc-100 text-zinc-500 border-zinc-200',
}

function evidenceTooltip(signal: MiraxSignal): string {
  const lines = signal.evidence.map((e) => `${e.label}: ${e.value} (${e.source})`)
  const retry =
    signal.status === 'unknown' && signal.retryAfterMinutes
      ? `Riprova tra ~${signal.retryAfterMinutes} min`
      : null
  return [signal.reason, retry, ...lines].filter(Boolean).join('\n')
}

export function BusinessSignalBadge({ signals, compact = false }: Props) {
  const top = signals[0]
  if (!top) return null

  const tone =
    top.status === 'unknown' ? TONE.unknown : TONE[top.severity] || TONE.medium
  const Icon = top.signalType === 'hiring' ? Briefcase : top.signalType === 'registry_change' ? TrendingUp : Gauge

  return (
    <span
      title={evidenceTooltip(top)}
      className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide leading-none ${tone}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {compact
        ? (top.signalType === 'site_stale' ? 'Datato' : top.signalType === 'meta_ads_started' ? 'Meta' : 'Biz')
        : signals.length > 1
          ? `${signals.length} segnali biz`
          : top.title.length > 28
            ? `${top.title.slice(0, 26)}…`
            : top.title}
    </span>
  )
}

export default BusinessSignalBadge
