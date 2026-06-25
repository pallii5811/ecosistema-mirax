export type OpportunityTag = {
  label: string
  emoji: string
  color: 'red' | 'orange' | 'amber' | 'emerald' | 'blue' | 'violet' | 'slate'
  priority: 'critical' | 'high' | 'medium' | 'low'
  description: string
  service: string
  estimatedValue: string
}

export type ScoreBreakdownItem = {
  factor: string
  points: number
  active: boolean
  tip: string
}

export type LeadIntelligence = {
  digitalMaturity: number
  digitalMaturityLabel: string
  opportunityTags: OpportunityTag[]
  estimatedDealRange: { min: number; max: number }
  urgency: 'alta' | 'media' | 'bassa'
  urgencyReason: string
  scoreBreakdown: ScoreBreakdownItem[]
  suggestedApproach: string
  suggestedServices: string[]
  competitorAdvantage: string
}

function extractBool(lead: any, ...keys: string[]): boolean | null {
  for (const k of keys) {
    if (lead[k] === true) return true
    if (lead[k] === false) return false
  }
  if (lead.technical_report && typeof lead.technical_report === 'object') {
    for (const k of keys) {
      if (lead.technical_report[k] === true) return true
      if (lead.technical_report[k] === false) return false
    }
  }
  return null
}

export function analyzeLead(lead: any): LeadIntelligence {
  const hasPixel = extractBool(lead, 'meta_pixel', 'has_pixel', 'has_facebook_pixel') === true
  const hasGtm = extractBool(lead, 'google_tag_manager', 'has_gtm') === true
  const hasAds = extractBool(lead, 'google_ads', 'has_google_ads') === true
  const hasAnalytics = extractBool(lead, 'google_analytics', 'has_ga4') === true
  const hasSsl = extractBool(lead, 'ssl', 'has_ssl') !== false
  const seoDisaster = extractBool(lead, 'seo_disaster') === true
  const htmlErrors = extractBool(lead, 'html_errors') === true
  const hasEmail = typeof lead.email === 'string' && lead.email.trim().length > 0
  const hasPhone = !!(lead.telefono || lead.phone || '').toString().trim()
  const hasInstagram = !!(lead.instagram || '').toString().trim()
  const speedSlow = typeof lead.load_speed_seconds === 'number' && lead.load_speed_seconds > 3
  const rating = typeof lead.rating === 'number' ? lead.rating : typeof lead.stelle === 'number' ? lead.stelle : null
  const nome = (lead.azienda || lead.nome || lead.name || lead.business_name || '').toString().trim()
  const category = (lead.categoria || lead.category || '').toString().trim()

  // ── Digital Maturity ──
  let maturity = 30
  if (hasPixel) maturity += 15
  if (hasGtm) maturity += 12
  if (hasAds) maturity += 12
  if (hasAnalytics) maturity += 10
  if (hasSsl) maturity += 6
  if (!seoDisaster) maturity += 5
  if (!htmlErrors) maturity += 4
  if (!speedSlow) maturity += 3
  if (hasInstagram) maturity += 3
  maturity = Math.min(100, Math.max(0, maturity))

  const digitalMaturityLabel =
    maturity >= 80 ? 'Avanzato' : maturity >= 55 ? 'Intermedio' : maturity >= 30 ? 'Base' : 'Critico'

  // ── Tags ──
  const tags: OpportunityTag[] = []

  if (!hasPixel && !hasGtm && !hasAds && !hasAnalytics) {
    tags.push({ label: 'Setup Digitale Completo Necessario', emoji: '🔴', color: 'red', priority: 'critical',
      description: 'Nessun pixel, tag manager, ads o analytics. Questa azienda opera completamente al buio online.',
      service: 'Digital Marketing Setup Completo', estimatedValue: '€2.000 – €5.000' })
  }
  if (!hasPixel) {
    tags.push({ label: 'No Facebook Pixel', emoji: '📊', color: 'orange', priority: 'high',
      description: 'Non stanno facendo retargeting sui visitatori. Perdono conversioni ogni giorno.',
      service: 'Facebook & Instagram Ads', estimatedValue: '€500 – €2.000/mese' })
  }
  if (!hasGtm) {
    tags.push({ label: 'No Tag Manager', emoji: '🏷️', color: 'orange', priority: 'high',
      description: 'Nessun GTM. Impossibile gestire tracking e conversioni in modo efficiente.',
      service: 'Google Tag Manager Setup', estimatedValue: '€300 – €800' })
  }
  if (!hasAds) {
    tags.push({ label: 'No Google Ads', emoji: '📈', color: 'amber', priority: 'high',
      description: 'Non usano Google Ads. Stanno cedendo traffico di ricerca ai concorrenti.',
      service: 'Google Ads Management', estimatedValue: '€500 – €3.000/mese' })
  }
  if (!hasAnalytics) {
    tags.push({ label: 'Zero Analytics', emoji: '🔍', color: 'red', priority: 'critical',
      description: 'Nessun Google Analytics. Non sanno quante visite ricevono né da dove arrivano.',
      service: 'Analytics & Tracking Setup', estimatedValue: '€300 – €600' })
  }
  if (!hasSsl) {
    tags.push({ label: 'Sito Non Sicuro (No SSL)', emoji: '🔓', color: 'red', priority: 'critical',
      description: 'Il sito mostra "Non sicuro". Perdita di fiducia e penalizzazione SEO.',
      service: 'SSL & Sicurezza Web', estimatedValue: '€100 – €300' })
  }
  if (seoDisaster || htmlErrors) {
    tags.push({ label: 'Problemi SEO Critici', emoji: '⚠️', color: 'orange', priority: 'high',
      description: 'Errori SEO e/o HTML gravi. Il sito sta perdendo posizionamento su Google.',
      service: 'SEO Audit & Ottimizzazione', estimatedValue: '€800 – €2.500' })
  }
  if (speedSlow) {
    tags.push({ label: 'Sito Lento', emoji: '🐌', color: 'amber', priority: 'medium',
      description: 'Tempo di caricamento > 3 secondi. Il 53% degli utenti abbandona dopo 3s.',
      service: 'Ottimizzazione Performance', estimatedValue: '€500 – €1.500' })
  }
  if (!hasInstagram && category) {
    tags.push({ label: 'Assente sui Social', emoji: '📱', color: 'amber', priority: 'medium',
      description: 'Nessuna presenza Instagram rilevata. Opportunità di social media marketing.',
      service: 'Social Media Management', estimatedValue: '€300 – €1.500/mese' })
  }
  if (hasEmail && hasPhone) {
    tags.push({ label: 'Contatto Diretto Disponibile', emoji: '✅', color: 'emerald', priority: 'low',
      description: 'Email e telefono disponibili. Contatto diretto possibile.',
      service: '', estimatedValue: '' })
  }
  if (rating !== null && rating >= 4.0) {
    tags.push({ label: 'Alta Reputazione Online', emoji: '⭐', color: 'blue', priority: 'low',
      description: `Rating ${rating}/5. Azienda con buona reputazione, più propensa a investire.`,
      service: '', estimatedValue: '' })
  }

  tags.sort((a, b) => {
    const p = { critical: 0, high: 1, medium: 2, low: 3 }
    return p[a.priority] - p[b.priority]
  })

  // ── Deal estimate ──
  let dealMin = 0; let dealMax = 0
  for (const t of tags) {
    if (!t.estimatedValue) continue
    const matches = t.estimatedValue.match(/[\d.]+/g)
    if (matches && matches.length >= 2) {
      dealMin += parseFloat(matches[0]) || 0
      dealMax += parseFloat(matches[1]) || 0
    } else if (matches && matches.length === 1) {
      dealMin += parseFloat(matches[0]) || 0
      dealMax += parseFloat(matches[0]) || 0
    }
  }

  // ── Urgency ──
  const criticalCount = tags.filter(t => t.priority === 'critical').length
  const highCount = tags.filter(t => t.priority === 'high').length
  let urgency: 'alta' | 'media' | 'bassa' = 'bassa'
  let urgencyReason = 'Lead con maturità digitale sufficiente.'
  if (criticalCount >= 2) {
    urgency = 'alta'
    urgencyReason = `${criticalCount} problemi critici rilevati. Questa azienda sta perdendo clienti e soldi ogni giorno.`
  } else if (criticalCount >= 1 || highCount >= 2) {
    urgency = 'media'
    urgencyReason = 'Problemi significativi rilevati. Buona opportunità di vendita.'
  }

  // ── Score Breakdown ──
  const scoreBreakdown: ScoreBreakdownItem[] = [
    { factor: 'No Facebook Pixel', points: 25, active: !hasPixel,
      tip: hasPixel ? 'Pixel presente — meno bisogno di ads setup' : 'Non hanno il pixel → vendi Facebook Ads' },
    { factor: 'No Google Tag Manager', points: 15, active: !hasGtm,
      tip: hasGtm ? 'GTM attivo — tracking funzionante' : 'Nessun GTM → vendi setup tracking' },
    { factor: 'Ha Email', points: 20, active: hasEmail,
      tip: hasEmail ? 'Email disponibile → contatto diretto possibile' : 'Nessuna email → contatto più difficile' },
    { factor: 'Errori SEO', points: 15, active: seoDisaster || htmlErrors,
      tip: (seoDisaster || htmlErrors) ? 'Problemi SEO → vendi ottimizzazione' : 'SEO in ordine' },
    { factor: 'Sito Lento (>3s)', points: 10, active: speedSlow,
      tip: speedSlow ? 'Sito lento → vendi ottimizzazione performance' : 'Velocità accettabile' },
    { factor: 'No SSL', points: 10, active: !hasSsl,
      tip: hasSsl ? 'SSL presente — sito sicuro' : 'Nessun SSL → vendi sicurezza web' },
    { factor: 'No Google Ads', points: 5, active: !hasAds,
      tip: hasAds ? 'Già usa Google Ads' : 'Non usa Ads → vendi gestione campagne' },
  ]

  // ── Suggested services ──
  const suggestedServices = tags.filter(t => t.service).map(t => t.service)

  // ── Approach strategy ──
  let suggestedApproach = ''
  if (urgency === 'alta') {
    suggestedApproach = `${nome || 'Questa azienda'} ha gravi lacune nel digitale. Approccio consigliato: contatto diretto${hasPhone ? ' telefonico' : hasEmail ? ' via email' : ''}, presentando un audit gratuito del loro sito. Mostra i problemi concreti (nessun tracking, nessun ads) e quantifica quanto stanno perdendo in clienti. Proponi un pacchetto completo di setup digitale.`
  } else if (urgency === 'media') {
    suggestedApproach = `${nome || 'Questa azienda'} ha alcune lacune importanti. Approccio consigliato: ${hasEmail ? 'email personalizzata' : 'contatto'} che evidenzia 1-2 problemi specifici (es. "il vostro sito non ha ${!hasPixel ? 'Facebook Pixel' : !hasAds ? 'Google Ads' : 'analytics'}") e propone un miglioramento misurabile. Focalizzati su ROI concreto.`
  } else {
    suggestedApproach = `${nome || 'Questa azienda'} ha una presenza digitale discreta. Approccio consigliato: posizionati come partner di crescita, non come risolutore di problemi. Proponi strategie avanzate (retargeting, automation, scaling ads) per portarli al livello successivo.`
  }

  // ── Competitor advantage ──
  const gaps = []
  if (!hasPixel) gaps.push('retargeting')
  if (!hasAds) gaps.push('Google Ads')
  if (!hasAnalytics) gaps.push('analytics')
  if (!hasInstagram) gaps.push('social media')
  const competitorAdvantage = gaps.length > 0
    ? `I concorrenti di ${nome || 'questa azienda'} che investono in ${gaps.slice(0, 2).join(' e ')} stanno catturando i clienti che loro perdono. Ogni giorno senza ${gaps[0]} è un giorno in cui i concorrenti vincono.`
    : `${nome || 'Questa azienda'} ha una buona base digitale. Il vantaggio competitivo si ottiene con strategie avanzate di automazione e scaling.`

  return {
    digitalMaturity: maturity,
    digitalMaturityLabel,
    opportunityTags: tags,
    estimatedDealRange: { min: dealMin, max: dealMax },
    urgency,
    urgencyReason,
    scoreBreakdown,
    suggestedApproach,
    suggestedServices: [...new Set(suggestedServices)],
    competitorAdvantage,
  }
}
