'use client'

import { MessageCircle, MapPin, Building2 } from 'lucide-react'
import { analyzeMiraxSignals } from '@/lib/mirax-signals'
import { calculateIntentScoreFromLead } from '@/lib/scoring/intent-score'
import { IntentScoreBadge } from '@/components/IntentScoreBadge'
import { discoveryMotivo, discoveryPitch } from '@/lib/discovery-copy'
import { OutreachLauncher } from '@/components/OutreachLauncher'
import { LeadComplianceBadge } from '@/components/LeadComplianceBadge'
import { MarketingInvestorBadge } from '@/components/MarketingInvestorBadge'

type Props = {
  lead: Record<string, unknown>
  searchId?: string | null
}

function readString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function DiscoveryLeadCard({ lead, searchId }: Props) {
  const summary = analyzeMiraxSignals(lead)
  const intentBreakdown = calculateIntentScoreFromLead(lead)
  const name = readString(lead, ['azienda', 'nome', 'company', 'name']) || 'Azienda'
  const city = readString(lead, ['citta', 'city', 'localita'])
  const categoria = readString(lead, ['categoria', 'category'])
  const sito = readString(lead, ['sito', 'website', 'url'])
  const email = readString(lead, ['email', 'mail'])
  const telefono = readString(lead, ['telefono', 'phone'])
  const motivo = discoveryMotivo(summary.primaryReason, summary.signals)
  const pitch = discoveryPitch(summary.signals.length ? summary.signals : summary.buying.signals)

  const labelTone =
    summary.label === 'caldissimo' || summary.label === 'caldo'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : summary.label === 'interessante'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200'

  return (
    <article className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-violet-500 flex-shrink-0" />
            <h3 className="font-bold text-slate-900 truncate">{name}</h3>
          </div>
          {(city || categoria) && (
            <p className="mt-1 text-xs text-slate-500 flex items-center gap-1 flex-wrap">
              {city ? (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="h-3 w-3" /> {city}
                </span>
              ) : null}
              {categoria ? <span className="rounded-full bg-slate-100 px-2 py-0.5">{categoria}</span> : null}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <IntentScoreBadge breakdown={intentBreakdown} compact />
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${labelTone}`}>
            {summary.label}
          </span>
          {(summary.intentSignals?.length ?? 0) > 0 ? <MarketingInvestorBadge compact /> : null}
          <LeadComplianceBadge status="unknown" compact />
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 mb-0.5">Perché contattarlo</p>
          <p className="text-sm font-medium text-slate-800 leading-snug">{motivo}</p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-1">
            <MessageCircle className="h-3 w-3" /> Pitch suggerito
          </p>
          <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{pitch}</p>
        </div>
      </div>

      <div className="mt-auto pt-1 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        {sito ? (
          <a
            href={sito.startsWith('http') ? sito : `https://${sito}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-600 hover:underline truncate max-w-[50%]"
          >
            {sito.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <span className="text-xs text-slate-400">Senza sito</span>
        )}
        <OutreachLauncher
          nome={name}
          citta={city}
          categoria={categoria}
          sito={sito}
          email={email}
          telefono={telefono}
          leadId={searchId || undefined}
          pitchBody={pitch}
          variant="primary"
          label="Contatta"
          className="!px-3 !py-2 !text-xs"
        />
      </div>
    </article>
  )
}

export default DiscoveryLeadCard
