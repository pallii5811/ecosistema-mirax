'use client'

import { intentScoreTone, type IntentScoreBreakdown } from '@/lib/scoring/intent-score'

type Props = {
  breakdown: IntentScoreBreakdown
  compact?: boolean
}

export function IntentScoreBadge({ breakdown, compact = false }: Props) {
  const { score, contributors } = breakdown
  const tooltip =
    contributors.length > 0
      ? `Intent Score ${score}/100\n\nPerché questo punteggio?\n${contributors.map((c) => `• ${c}`).join('\n')}`
      : score > 0
        ? `Intent Score ${score}/100`
        : 'Intent Score 0 — nessun segnale business rilevato'

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold tabular-nums leading-none ${intentScoreTone(score)} ${
        compact ? 'text-[9px]' : 'text-[10px]'
      }`}
    >
      {compact ? `Intent ${score}` : `Intent ${score}/100`}
    </span>
  )
}

export default IntentScoreBadge
