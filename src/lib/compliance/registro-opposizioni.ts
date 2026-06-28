/**
 * Registro Opposizioni — check pre-outreach telefonico/WhatsApp (B2B con cautela GDPR).
 * Modalità:
 * - mock (default dev): numeri test + env block list
 * - off: sempre unknown (utente conferma manualmente)
 * - api: integrazione servizio autorizzato (placeholder)
 */

import type { ComplianceChannel, ComplianceCheckResult, ComplianceStatus } from '@/lib/compliance/types'

const MODE = (process.env.REGISTRO_OPPOSIZIONI_MODE || 'mock').toLowerCase()

/** Numeri di test: blocked per QA */
const MOCK_BLOCKED_PHONES = new Set([
  '393399999999',
  '3399999999',
  '3339999999',
])

/** Email di test bloccate */
const MOCK_BLOCKED_EMAILS = new Set(['blocked-test@mirax.local', 'opposizione@test.it'])

export function normalizePhoneTarget(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0039')) return digits.slice(2)
  if (digits.startsWith('39') && digits.length >= 11) return digits
  if (digits.length >= 9 && digits.length <= 10) return `39${digits}`
  return digits
}

export function normalizeEmailTarget(raw: string): string {
  return raw.trim().toLowerCase()
}

function statusMessage(status: ComplianceStatus, channel: ComplianceChannel): string {
  if (status === 'clear') {
    return channel === 'email'
      ? 'Contatto email consentito — fonte pubblica B2B, base legittimo interesse documentata.'
      : 'Numero non risulta in Registro Opposizioni (verifica mock/servizio).'
  }
  if (status === 'blocked') {
    return channel === 'email'
      ? 'Contatto non disponibile — indirizzo in lista opposizioni interna.'
      : 'In Registro Opposizioni — outreach telefonico non disponibile.'
  }
  if (status === 'manual_review') {
    return 'Verifica manuale consigliata: servizio Registro Opposizioni non disponibile.'
  }
  return 'Verifica consigliata prima del primo contatto.'
}

async function checkViaAuthorizedService(_phone: string): Promise<ComplianceStatus> {
  // Placeholder per integrazione API autorizzata (PR futuro)
  return 'manual_review'
}

export async function checkRegistroOpposizioni(params: {
  channel: ComplianceChannel
  target: string
}): Promise<ComplianceCheckResult> {
  const checkedAt = new Date().toISOString()
  const channel = params.channel
  let target = params.target.trim()
  let checkType: ComplianceCheckResult['checkType'] = 'registro_opposizioni'

  if (channel === 'email') {
    target = normalizeEmailTarget(target)
    checkType = 'gdpr_basis_logged'

    if (MODE === 'off') {
      return {
        status: 'unknown',
        channel,
        target,
        checkType,
        message: statusMessage('unknown', channel),
        checkedAt,
      }
    }

    if (MOCK_BLOCKED_EMAILS.has(target)) {
      return {
        status: 'blocked',
        channel,
        target,
        checkType,
        message: statusMessage('blocked', channel),
        checkedAt,
        raw: { mode: MODE, reason: 'mock_blocked_list' },
      }
    }

    return {
      status: 'clear',
      channel,
      target,
      checkType,
      message: statusMessage('clear', channel),
      checkedAt,
      raw: { mode: MODE, basis: 'legittimo_interesse_b2b_fonte_pubblica' },
    }
  }

  // phone / whatsapp
  target = normalizePhoneTarget(target)
  checkType = 'registro_opposizioni'

  if (MODE === 'off') {
    return {
      status: 'unknown',
      channel,
      target,
      checkType,
      message: statusMessage('unknown', channel),
      checkedAt,
    }
  }

  if (MOCK_BLOCKED_PHONES.has(target) || MOCK_BLOCKED_PHONES.has(target.replace(/^39/, ''))) {
    return {
      status: 'blocked',
      channel,
      target,
      checkType,
      message: statusMessage('blocked', channel),
      checkedAt,
      raw: { mode: MODE, reason: 'mock_registro_opposizioni' },
    }
  }

  if (MODE === 'api') {
    const apiStatus = await checkViaAuthorizedService(target)
    return {
      status: apiStatus,
      channel,
      target,
      checkType,
      message: statusMessage(apiStatus, channel),
      checkedAt,
      raw: { mode: 'api' },
    }
  }

  // mock default: clear for B2B business numbers
  return {
    status: 'clear',
    channel,
    target,
    checkType,
    message: statusMessage('clear', channel),
    checkedAt,
    raw: { mode: MODE, note: 'Mock — usa 3399999999 per test blocco' },
  }
}

export async function checkOutreachCompliance(params: {
  channel: ComplianceChannel
  email?: string | null
  phone?: string | null
}): Promise<ComplianceCheckResult | null> {
  const { channel, email, phone } = params

  if (channel === 'email') {
    if (!email?.trim()) return null
    return checkRegistroOpposizioni({ channel: 'email', target: email })
  }

  if (channel === 'whatsapp' || channel === 'phone') {
    const raw = phone?.trim()
    if (!raw) return null
    return checkRegistroOpposizioni({ channel: channel === 'whatsapp' ? 'whatsapp' : 'phone', target: raw })
  }

  return null
}
