'use client'

import { Megaphone } from 'lucide-react'

type Props = {
  compact?: boolean
}

/** Badge F2-B — investitore marketing (intent_marketing_spend). */
export function MarketingInvestorBadge({ compact = false }: Props) {
  return (
    <span
      title="Segnali di investimento attivo in marketing digitale (Meta/Google ads, sito performante)"
      className="inline-flex items-center gap-0.5 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fuchsia-700 leading-none"
    >
      <Megaphone className="h-2.5 w-2.5" />
      {compact ? 'Ads' : 'Investitore marketing'}
    </span>
  )
}

export default MarketingInvestorBadge
