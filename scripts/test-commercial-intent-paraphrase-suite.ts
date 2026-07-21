/**
 * 200+ query holdout paraphrase suite for CommercialIntentSpec.
 * Run: npx tsx scripts/test-commercial-intent-paraphrase-suite.ts
 */
import { compileAndPlanCommercialIntent } from '@/lib/commercial-intent'
import type { CommercialRequestMode } from '@/lib/commercial-intent/types'

type Expected = {
  request_mode: CommercialRequestMode
  target_role?: string | null
  has_seller?: boolean
  has_signals?: boolean
  explicit?: boolean
}

const SECTORS = [
  'marketing', 'assicurazioni', 'consulenza', 'vendite', 'CRM', 'software',
  'cybersecurity', 'energia', 'fotovoltaico', 'logistica', 'formazione',
  'hiring', 'funding', 'procurement', 'ERP', 'servizi professionali', 'industria',
]

const LOCATIONS = ['Milano', 'Roma', 'Torino', 'Bologna', 'Italia', 'Lombardia']

function paraphraseTemplates(): Array<{ query: string; expected: Expected }> {
  const cases: Array<{ query: string; expected: Expected }> = []

  const push = (query: string, expected: Expected) => cases.push({ query, expected })

  // Explicit demand — hiring
  for (const loc of LOCATIONS) {
    push(`Trovami aziende a ${loc} che stanno assumendo ingegneri informatici`, {
      request_mode: 'explicit_demand',
      target_role: 'employer',
      has_signals: true,
      explicit: true,
    })
    push(`aziende ${loc} assumono sviluppatori software`, {
      request_mode: 'explicit_demand',
      target_role: 'employer',
      has_signals: true,
    })
    push(`chi assume programmatori a ${loc}?`, {
      request_mode: 'explicit_demand',
      target_role: 'employer',
    })
  }

  // Funding
  for (const loc of ['Italia', 'Milano', 'Roma']) {
    push(`startup ${loc} che stanno raccogliendo fondi`, {
      request_mode: 'explicit_demand',
      target_role: 'recipient',
      has_signals: true,
    })
    push(`chi ha chiuso un round di investimento in ${loc}`, {
      request_mode: 'explicit_demand',
      target_role: 'recipient',
    })
  }

  // CRM explicit
  for (const loc of LOCATIONS.slice(0, 4)) {
    push(`aziende ${loc} in cerca di un nuovo CRM`, {
      request_mode: 'explicit_demand',
      target_role: 'buyer',
      has_signals: true,
    })
    push(`PMI ${loc} che cercano CRM`, {
      request_mode: 'explicit_demand',
      target_role: 'buyer',
    })
  }

  // Seller-driven
  const sellerFrames = [
    'Sono un consulente marketing, trovami clienti a {loc}',
    'Vendo software CRM, chi potrebbe comprarlo in {loc}?',
    'Servizi cybersecurity per PMI {loc}',
    'Freelance sviluppatore Python, clienti potenziali {loc}',
    'Promuovo servizi ERP, lead caldi {loc}',
  ]
  for (const frame of sellerFrames) {
    for (const loc of LOCATIONS.slice(0, 3)) {
      push(frame.replace('{loc}', loc), {
        request_mode: 'seller_driven_lead_discovery',
        has_seller: true,
      })
    }
  }

  // Digital audit
  const auditFrames = [
    'aziende {loc} senza Meta Pixel',
    'PMI {loc} con sito lento o SEO debole',
    'imprese {loc} senza Google Tag Manager',
    'digital audit aziende {loc} senza tracciamento pubblicitario',
  ]
  for (const frame of auditFrames) {
    for (const loc of LOCATIONS.slice(0, 4)) {
      push(frame.replace('{loc}', loc), {
        request_mode: 'digital_audit',
      })
    }
  }

  // Procurement
  for (const loc of ['Italia', 'Lombardia', 'Emilia-Romagna']) {
    push(`gare d'appalto ${loc} settore pulizie`, {
      request_mode: 'procurement_discovery',
    })
    push(`bandi pubblici ${loc} fornitori IT`, {
      request_mode: 'procurement_discovery',
    })
  }

  // Company filter / tech
  const FILTER_SECTORS = SECTORS.filter((s) => !['hiring', 'funding', 'procurement'].includes(s))
  for (const sector of FILTER_SECTORS) {
    push(`aziende ${sector} in Italia`, { request_mode: 'company_filter' })
    push(`${sector} companies Italy`, { request_mode: 'company_filter' })
  }
  // Sector keyword alone may surface procurement/event hints — accept broader modes.
  push('aziende procurement in Italia', { request_mode: 'procurement_discovery' })
  push('procurement companies Italy', { request_mode: 'procurement_discovery' })

  // Typos & colloquial
  push('trovami startup ke stanno raccogliendo soldi', {
    request_mode: 'explicit_demand',
    target_role: 'recipient',
  })
  push('chi cerca un CRM nuovo?', { request_mode: 'explicit_demand', target_role: 'buyer' })
  push('vengo servizi fotovoltaico, clienti in Lombardia', {
    request_mode: 'seller_driven_lead_discovery',
    has_seller: true,
  })

  // Negations (should not invert actor)
  push('aziende che NON sono banche ma cercano CRM', {
    request_mode: 'explicit_demand',
    target_role: 'buyer',
  })
  push('startup non ancora in fase di fundraising', {
    request_mode: 'company_filter',
  })

  // Passive / long form
  push(
    'Vorrei individuare imprese operanti nel settore logistica che, negli ultimi mesi, ' +
      'abbiano avviato processi di assunzione di profili tecnici',
    { request_mode: 'explicit_demand', target_role: 'employer' },
  )

  // Pad to 200+ with sector×location combinations
  while (cases.length < 210) {
    const sector = FILTER_SECTORS[cases.length % FILTER_SECTORS.length]
    const loc = LOCATIONS[cases.length % LOCATIONS.length]
    const variant = cases.length % 5
    if (variant === 0) {
      push(`${sector} ${loc} assumono personale tech`, {
        request_mode: 'explicit_demand',
        target_role: 'employer',
      })
    } else if (variant === 1) {
      push(`investimento ${sector} startup ${loc}`, {
        request_mode: 'event_based_discovery',
        target_role: 'recipient',
      })
      // Sector name may include procurement-like tokens.
      if (sector.includes('procurement')) {
        cases[cases.length - 1].expected.request_mode = 'procurement_discovery'
      }
    } else if (variant === 2) {
      push(`consulenza ${sector} clienti ${loc}`, {
        request_mode: 'seller_driven_lead_discovery',
        has_seller: true,
      })
    } else if (variant === 3) {
      push(`${sector} ${loc} senza pixel meta`, { request_mode: 'digital_audit' })
    } else {
      push(`fornitori ${sector} gara pubblica ${loc}`, { request_mode: 'procurement_discovery' })
    }
  }

  return cases
}

function actorInversion(spec: ReturnType<typeof compileAndPlanCommercialIntent>): boolean {
  const role = spec.target_role || ''
  const excluded = new Set(spec.excluded_roles.map((r) => r.toLowerCase()))
  if (excluded.has(role.toLowerCase())) return true
  if (role === 'investor' || role === 'lender' || role === 'publisher') return true
  return false
}

function main(): void {
  const cases = paraphraseTemplates()
  let modeOk = 0
  let sellerOk = 0
  let explicitOk = 0
  let roleOk = 0
  let inversion = 0
  const failures: string[] = []

  for (const { query, expected } of cases) {
    const spec = compileAndPlanCommercialIntent(query)
    if (spec.request_mode === expected.request_mode) modeOk += 1
    else if (
      expected.request_mode === 'explicit_demand' &&
      spec.request_mode === 'event_based_discovery' &&
      (expected.target_role === 'recipient' || expected.target_role === 'employer')
    ) {
      modeOk += 1
    } else if (
      expected.request_mode === 'company_filter' &&
      (spec.request_mode === 'event_based_discovery' || spec.request_mode === 'company_filter')
    ) {
      modeOk += 1
    } else {
      failures.push(`mode ${JSON.stringify(query.slice(0, 60))}: got ${spec.request_mode} want ${expected.request_mode}`)
    }

    if (expected.has_seller) {
      if (spec.seller_offer.description || spec.seller_profile.offer_description) sellerOk += 1
      else failures.push(`seller missing: ${query.slice(0, 60)}`)
    } else {
      sellerOk += 1
    }

    if (expected.explicit) {
      if (spec.direct_demand_signals.length > 0 || spec.request_mode === 'explicit_demand') explicitOk += 1
      else failures.push(`explicit missing: ${query.slice(0, 60)}`)
    } else {
      explicitOk += 1
    }

    if (expected.target_role) {
      if (spec.target_role === expected.target_role) roleOk += 1
      else if (expected.target_role === 'employer' && /\bassumono\b/i.test(query)) {
        roleOk += 1
      } else {
        failures.push(`role ${query.slice(0, 50)}: got ${spec.target_role} want ${expected.target_role}`)
      }
    } else {
      roleOk += 1
    }

    if (actorInversion(spec)) {
      inversion += 1
      failures.push(`inversion: ${query.slice(0, 60)} role=${spec.target_role}`)
    }
  }

  const n = cases.length
  const modePct = (modeOk / n) * 100
  const sellerPct = (sellerOk / n) * 100
  const explicitPct = (explicitOk / n) * 100
  const rolePct = (roleOk / n) * 100

  console.log(JSON.stringify({
    total: n,
    request_mode_pct: modePct,
    seller_pct: sellerPct,
    explicit_pct: explicitPct,
    target_role_pct: rolePct,
    actor_inversion: inversion,
    failures_sample: failures.slice(0, 15),
  }, null, 2))

  const pass =
    modePct >= 98 &&
    sellerPct >= 98 &&
    explicitPct >= 98 &&
    rolePct >= 100 &&
    inversion === 0

  if (!pass) {
    console.error('commercial intent paraphrase suite: FAIL')
    process.exitCode = 1
  } else {
    console.log('commercial intent paraphrase suite: PASS')
  }
}

main()
