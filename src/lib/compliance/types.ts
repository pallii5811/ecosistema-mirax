export type ComplianceChannel = 'email' | 'phone' | 'whatsapp'
export type ComplianceCheckType = 'registro_opposizioni' | 'gdpr_basis_logged'
export type ComplianceStatus = 'clear' | 'blocked' | 'unknown' | 'manual_review'

export type ComplianceCheckResult = {
  status: ComplianceStatus
  channel: ComplianceChannel
  target: string
  checkType: ComplianceCheckType
  message: string
  checkedAt: string
  raw?: unknown
}

export const COMPLIANCE_UI_STATUS = {
  verified: {
    label: 'GDPR OK',
    title: 'Contatto consentito — fonte pubblica, base giuridica documentata',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  blocked: {
    label: 'Bloccato',
    title: 'In Registro Opposizioni — outreach non disponibile',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  unknown: {
    label: 'Da verificare',
    title: 'Verifica consigliata prima del primo contatto',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  manual_review: {
    label: 'Revisione',
    title: 'Verifica manuale consigliata prima del contatto',
    tone: 'bg-sky-50 text-sky-700 border-sky-200',
  },
} as const

export type ComplianceUiStatus = keyof typeof COMPLIANCE_UI_STATUS

export function toUiStatus(status: ComplianceStatus): ComplianceUiStatus {
  if (status === 'clear') return 'verified'
  if (status === 'blocked') return 'blocked'
  if (status === 'manual_review') return 'manual_review'
  return 'unknown'
}
