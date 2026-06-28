'use client'

import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { COMPLIANCE_UI_STATUS, toUiStatus, type ComplianceStatus } from '@/lib/compliance/types'

type Props = {
  status?: ComplianceStatus | null
  compact?: boolean
  className?: string
}

const ICONS = {
  verified: ShieldCheck,
  blocked: ShieldAlert,
  unknown: ShieldQuestion,
  manual_review: Shield,
} as const

export function LeadComplianceBadge({ status, compact = false, className = '' }: Props) {
  if (!status) return null
  const uiKey = toUiStatus(status)
  const meta = COMPLIANCE_UI_STATUS[uiKey]
  const Icon = ICONS[uiKey]

  return (
    <span
      title={meta.title}
      className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide leading-none ${meta.tone} ${className}`}
    >
      <Icon className="h-2.5 w-2.5 flex-shrink-0" />
      {compact ? meta.label.split(' ')[0] : meta.label}
    </span>
  )
}

export default LeadComplianceBadge
