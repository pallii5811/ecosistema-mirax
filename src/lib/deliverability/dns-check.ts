import { promises as dns } from 'dns'

export type DnsRecordFinding = {
  type: 'spf' | 'dkim' | 'dmarc'
  status: 'ok' | 'missing' | 'warning'
  value?: string
  message: string
}

export type DomainDeliverabilityReport = {
  domain: string
  checkedAt: string
  spf: DnsRecordFinding
  dmarc: DnsRecordFinding
  dkim: DnsRecordFinding[]
  score: number
  summary: string
}

const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 's1', 'mail', 'resend']

function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^@/, '')
}

async function resolveTxt(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(host)
    return records.map((parts) => parts.join(''))
  } catch {
    return []
  }
}

function analyzeSpf(records: string[]): DnsRecordFinding {
  const spf = records.find((r) => r.toLowerCase().startsWith('v=spf1'))
  if (!spf) {
    return { type: 'spf', status: 'missing', message: 'Record SPF assente — i provider possono rifiutare le email.' }
  }
  if (spf.includes('+all')) {
    return { type: 'spf', status: 'warning', value: spf, message: 'SPF con +all è permissivo — preferisci ~all o -all.' }
  }
  return { type: 'spf', status: 'ok', value: spf, message: 'SPF configurato correttamente.' }
}

function analyzeDmarc(records: string[]): DnsRecordFinding {
  const dmarc = records.find((r) => r.toLowerCase().startsWith('v=dmarc1'))
  if (!dmarc) {
    return { type: 'dmarc', status: 'missing', message: 'DMARC assente — consigliato per reputazione e deliverability.' }
  }
  if (/p=none/i.test(dmarc)) {
    return { type: 'dmarc', status: 'warning', value: dmarc, message: 'DMARC presente ma policy p=none — considera quarantine/reject.' }
  }
  return { type: 'dmarc', status: 'ok', value: dmarc, message: 'DMARC configurato.' }
}

async function checkDkim(domain: string): Promise<DnsRecordFinding[]> {
  const findings: DnsRecordFinding[] = []
  for (const sel of DKIM_SELECTORS) {
    const host = `${sel}._domainkey.${domain}`
    const txt = await resolveTxt(host)
    const dkim = txt.find((r) => r.toLowerCase().includes('v=dkim1') || r.includes('p='))
    if (dkim) {
      findings.push({
        type: 'dkim',
        status: 'ok',
        value: `${sel}: ${dkim.slice(0, 80)}…`,
        message: `DKIM trovato (selettore ${sel}).`,
      })
    }
  }
  if (findings.length === 0) {
    findings.push({
      type: 'dkim',
      status: 'missing',
      message: 'Nessun selettore DKIM comune trovato — verifica in Resend/Mailgun il record da pubblicare.',
    })
  }
  return findings
}

export async function checkDomainDeliverability(rawDomain: string): Promise<DomainDeliverabilityReport> {
  const domain = cleanDomain(rawDomain)
  if (!domain || !domain.includes('.')) {
    throw new Error('Dominio non valido')
  }

  const rootTxt = await resolveTxt(domain)
  const spf = analyzeSpf(rootTxt)
  const dmarcTxt = await resolveTxt(`_dmarc.${domain}`)
  const dmarc = analyzeDmarc(dmarcTxt)
  const dkim = await checkDkim(domain)

  let score = 0
  if (spf.status === 'ok') score += 35
  else if (spf.status === 'warning') score += 20
  if (dmarc.status === 'ok') score += 35
  else if (dmarc.status === 'warning') score += 20
  if (dkim.some((d) => d.status === 'ok')) score += 30

  const summary =
    score >= 80
      ? 'Configurazione solida per l\'invio B2B.'
      : score >= 50
        ? 'Parzialmente configurato — completa SPF/DKIM/DMARC prima di campagne cold.'
        : 'Rischio deliverability alto — configura DNS prima di inviare in volume.'

  return {
    domain,
    checkedAt: new Date().toISOString(),
    spf,
    dmarc,
    dkim,
    score,
    summary,
  }
}
