'use client'

import { useEffect, useState } from 'react'
import { Facebook, Hash, Instagram, Linkedin, Loader2, Calendar, Sparkles, ChevronDown, ChevronUp, Briefcase, ExternalLink, UserRound, Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getEnrichment, saveEnrichment } from '@/app/dashboard/enrichment/actions'
import type { LeadEnrichment } from '@/types/enrichment'

type Props = {
  website: string
  leadName: string
  lead?: Record<string, unknown>
}

type EnrichmentPreview = {
  linkedin_url: string | null
  instagram_url: string | null
  facebook_url: string | null
  partita_iva: string | null
  anno_fondazione: string | null
  dipendenti_stimati: string | null
  error?: string
}

type ExternalIntelligenceView = {
  decisionMakers?: Array<{
    name: string | null
    role: string
    linkedinUrl: string | null
    sourceUrl: string
    evidence: string
    confidence: number
  }>
  buyingTriggers?: Array<{
    type: string
    title: string
    sourceUrl: string
    evidence: string
    confidence: number
    suggestedOffer: string
  }>
}

type EnrichmentResponse = Partial<EnrichmentPreview> & {
  error?: string
}

type ExternalIntelligenceResponse = {
  intelligence?: ExternalIntelligenceView
  error?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function readString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key]
  return typeof value === 'string' ? value : ''
}

export function LeadEnrichmentPanel({ website, leadName, lead }: Props) {
  const [enrichment, setEnrichment] = useState<LeadEnrichment | null>(null)
  const [preview, setPreview] = useState<EnrichmentPreview | null>(null)
  const [externalIntel, setExternalIntel] = useState<ExternalIntelligenceView | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExternalLoading, setIsExternalLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [hasChecked, setHasChecked] = useState(false)

  useEffect(() => {
    if (!isExpanded || hasChecked) return
    const site = typeof website === 'string' ? website.trim() : ''
    if (!site) return

    setHasChecked(true)
    getEnrichment(site).then((data) => {
      if (data) {
        setEnrichment(data)
        setPreview(null)
      }
    })
  }, [hasChecked, isExpanded, website])

  const handleEnrich = async () => {
    const site = typeof website === 'string' ? website.trim() : ''
    if (!site) return

    setIsLoading(true)
    try {
      const res = await fetch('/api/enrich-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: site }),
      })

      const data = (await res.json().catch(() => null)) as EnrichmentResponse | null

      console.log('ENRICH RESULT:', data)

      const nextPreview: EnrichmentPreview = {
        linkedin_url: data?.linkedin_url ?? null,
        instagram_url: data?.instagram_url ?? null,
        facebook_url: data?.facebook_url ?? null,
        partita_iva: data?.partita_iva ?? null,
        anno_fondazione: data?.anno_fondazione ?? null,
        dipendenti_stimati: data?.dipendenti_stimati ?? null,
        error: typeof data?.error === 'string' ? data.error : undefined,
      }

      setPreview(nextPreview)

      const result = await saveEnrichment(site, {
        linkedin_url: data?.linkedin_url ?? null,
        instagram_url: data?.instagram_url ?? null,
        facebook_url: data?.facebook_url ?? null,
        partita_iva: data?.partita_iva ?? null,
        anno_fondazione: data?.anno_fondazione ?? null,
        dipendenti_stimati: data?.dipendenti_stimati ?? null,
        extra_data: { lead_name: leadName || null, api_error: data?.error ?? null },
      })

      if (result.success && result.data) {
        setEnrichment(result.data)
        setPreview(null)
      }
    } catch (e) {
      console.error('Enrichment error:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleExternalIntel = async () => {
    const site = typeof website === 'string' ? website.trim() : ''
    const baseLead = lead && typeof lead === 'object' ? lead : {}
    const payloadLead = {
      ...baseLead,
      sito: readString(baseLead, 'sito') || readString(baseLead, 'website') || site,
      nome: readString(baseLead, 'nome') || readString(baseLead, 'azienda') || readString(baseLead, 'business_name') || leadName,
    }

    setIsExternalLoading(true)
    try {
      const res = await fetch('/api/external-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: payloadLead }),
      })
      const data = (await res.json().catch(() => null)) as ExternalIntelligenceResponse | null
      if (res.ok && data?.intelligence) {
        setExternalIntel(data.intelligence)
      } else {
        setExternalIntel({
          buyingTriggers: [{
            type: 'error',
            title: data?.error || 'Intelligence esterna non disponibile',
            sourceUrl: '',
            evidence: '',
            confidence: 0,
            suggestedOffer: '',
          }],
        })
      }
    } catch (e) {
      console.error('External intelligence error:', e)
      setExternalIntel({
        buyingTriggers: [{
          type: 'error',
          title: 'Errore intelligence esterna',
          sourceUrl: '',
          evidence: '',
          confidence: 0,
          suggestedOffer: '',
        }],
      })
    } finally {
      setIsExternalLoading(false)
    }
  }

  const rawView = enrichment || preview
  const view = asRecord(rawView)
  const errorText = readString(view, 'error')
  const linkedinUrl = readString(view, 'linkedin_url')
  const instagramUrl = readString(view, 'instagram_url')
  const facebookUrl = readString(view, 'facebook_url')
  const partitaIva = readString(view, 'partita_iva')
  const annoFondazione = readString(view, 'anno_fondazione')

  const hasAnyResponse = !!rawView

  const hasData =
    !!(
      linkedinUrl ||
      instagramUrl ||
      facebookUrl ||
      partitaIva ||
      annoFondazione ||
      readString(view, 'dipendenti_stimati')
    )

  const externalIntelPanel = (
    <div className="pt-2 mt-2 border-t border-purple-100">
      <button
        type="button"
        onClick={handleExternalIntel}
        disabled={isExternalLoading}
        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
      >
        {isExternalLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Megaphone className="w-3 h-3" />}
        {isExternalLoading ? 'Cerco segnali...' : 'Trigger esterni'}
      </button>

      {externalIntel ? (
        <div className="mt-2 space-y-2">
          {(externalIntel.decisionMakers || []).slice(0, 3).map((person, i) => (
            <div key={`person-${i}`} className="rounded-md bg-white border border-indigo-100 p-2">
              <div className="flex items-start gap-2">
                <UserRound className="w-3.5 h-3.5 text-indigo-500 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800">{person.name || 'Persona da verificare'}</div>
                  <div className="text-[11px] text-slate-600">{person.role}</div>
                  {person.linkedinUrl || person.sourceUrl ? (
                    <a href={person.linkedinUrl || person.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline">
                      fonte <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {(externalIntel.buyingTriggers || []).slice(0, 4).map((trigger, i) => (
            <div key={`trigger-${i}`} className="rounded-md bg-white border border-amber-100 p-2">
              <div className="flex items-start gap-2">
                <Briefcase className="w-3.5 h-3.5 text-amber-600 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800">{trigger.title}</div>
                  {trigger.evidence ? <div className="text-[11px] text-slate-600 line-clamp-2">{trigger.evidence}</div> : null}
                  {trigger.suggestedOffer ? <div className="text-[11px] text-amber-700 font-medium mt-0.5">{trigger.suggestedOffer}</div> : null}
                  {trigger.sourceUrl ? (
                    <a href={trigger.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline">
                      fonte <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {(externalIntel.decisionMakers || []).length === 0 && (externalIntel.buyingTriggers || []).length === 0 ? (
            <div className="text-xs text-gray-500">Nessun trigger esterno forte trovato.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setIsExpanded((p) => !p)}
        className="mt-1 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-gradient-to-r from-violet-600/10 to-purple-600/5 px-3 py-1 text-xs font-semibold text-violet-700 transition-all duration-200 hover:from-violet-600 hover:to-purple-600 hover:text-white"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Arricchisci
        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {isExpanded ? (
        <div className="mt-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
          {!hasAnyResponse ? (
            <Button
              size="sm"
              onClick={handleEnrich}
              disabled={isLoading || !website}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-7"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" /> Analisi in corso...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3 mr-1" /> Analizza azienda
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-1.5">
              {errorText ? (
                <div className="text-xs text-amber-700">{errorText}</div>
              ) : null}

              {linkedinUrl ? (
                <a
                  href={linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-blue-700 hover:underline"
                >
                  <Linkedin className="w-3 h-3" /> LinkedIn
                </a>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Linkedin className="w-3 h-3" /> LinkedIn: Non trovato
                </div>
              )}

              {instagramUrl ? (
                <a
                  href={instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-pink-600 hover:underline"
                >
                  <Instagram className="w-3 h-3" /> Instagram
                </a>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Instagram className="w-3 h-3" /> Instagram: Non trovato
                </div>
              )}

              {facebookUrl ? (
                <a
                  href={facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                >
                  <Facebook className="w-3 h-3" /> Facebook
                </a>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Facebook className="w-3 h-3" /> Facebook: Non trovato
                </div>
              )}

              {partitaIva ? (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Hash className="w-3 h-3" /> P.IVA: {partitaIva}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Hash className="w-3 h-3" /> P.IVA: Non trovata
                </div>
              )}

              {annoFondazione ? (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Calendar className="w-3 h-3" /> Dal {annoFondazione}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Calendar className="w-3 h-3" /> Anno: Non trovato
                </div>
              )}

              <button
                type="button"
                onClick={handleEnrich}
                disabled={isLoading}
                className="text-xs text-purple-500 hover:text-purple-700 mt-1"
              >
                {isLoading ? 'Aggiornamento...' : 'Aggiorna dati'}
              </button>

              {!hasData ? <div className="text-xs text-gray-500">Nessun dato trovato sul sito.</div> : null}
            </div>
          )}
          {externalIntelPanel}
        </div>
      ) : null}
    </div>
  )
}
