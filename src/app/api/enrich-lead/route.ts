/**
 * POST /api/enrich-lead
 * Clay-style enrichment: combines ALL available sources for a single lead
 * 
 * Input: { lead: { nome, sito, telefono, email, citta, categoria, indirizzo } }
 *   OR:  { url: string }  (legacy: basic website scraping)
 * 
 * Output: Full ClayEnrichedLead object with all enriched data
 */
import { NextRequest, NextResponse } from 'next/server'
import { clayEnrichLead } from '@/lib/clay-enrichment'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { ingestClayEnrichedLead } from '@/lib/universe'

function hasUsefulContactOrSocialData(data: any) {
  return Boolean(
    data?.bestEmail ||
    data?.bestPhone ||
    data?.mobilePhone ||
    data?.pecEmail ||
    (Array.isArray(data?.allEmails) && data.allEmails.length > 0) ||
    (Array.isArray(data?.allPhones) && data.allPhones.length > 0) ||
    data?.linkedinCompany ||
    data?.linkedinPerson ||
    data?.facebook ||
    data?.instagram ||
    data?.tiktok ||
    data?.youtube ||
    data?.twitter
  )
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const forceRefresh = body?.forceRefresh === true || req.nextUrl.searchParams.get('refresh') === '1'

    // ── New Clay-style enrichment (full lead) ───────────────────
    if (body.lead) {
      const leadPayload = body.lead;
      
      // Attempt to check cache if website is provided
      let normalizedDomain = '';
      if (leadPayload.sito) {
        normalizedDomain = leadPayload.sito.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim().toLowerCase();
      }

      if (normalizedDomain && !forceRefresh) {
        try {
          const supabaseAdmin = createServiceRoleClient();
          const { data: cached, error } = await supabaseAdmin
            .from('leads_cache')
            .select('data, updated_at')
            .eq('domain', normalizedDomain)
            .maybeSingle();

          if (!error && cached && cached.data) {
            const updatedAtMs = new Date(cached.updated_at).getTime();
            // Valid for 3 months (90 days)
            if (Date.now() - updatedAtMs < 90 * 24 * 60 * 60 * 1000 && hasUsefulContactOrSocialData(cached.data)) {
              console.log('[enrich-lead] Return from cache for:', normalizedDomain);
              return NextResponse.json(cached.data);
            }
          }
        } catch (err) {
          console.warn('[enrich-lead] Cache read failed (maybe table missing):', err);
        }
      }

      // Not in cache, or cache expired, let's fetch fresh data
      const enriched = await clayEnrichLead(leadPayload);

      // Save to cache asynchronously, fail-safe pattern
      if (normalizedDomain && enriched) {
        Promise.resolve().then(async () => {
          try {
            const supabaseAdmin = createServiceRoleClient();
            await supabaseAdmin.from('leads_cache').upsert({
              domain: normalizedDomain,
              data: enriched,
              updated_at: new Date().toISOString()
            }, { onConflict: 'domain' });
            console.log('[enrich-lead] Saved to cache:', normalizedDomain);
          } catch (e) {
            console.warn('[enrich-lead] Could not save to cache:', e);
          }
        }).catch(() => {});
      }

      // Universe sidecar ingest (Phase 3)
      if (process.env.UNIVERSE_ENABLED === '1' && enriched) {
        Promise.resolve().then(async () => {
          try {
            const supabaseAdmin = createServiceRoleClient();
            await ingestClayEnrichedLead(supabaseAdmin, enriched, 'clay_enrichment', user?.id);
            console.log('[enrich-lead] Universe ingest ok:', normalizedDomain);
          } catch (e) {
            console.warn('[enrich-lead] Universe ingest failed:', e);
          }
        }).catch(() => {});
      }

      return NextResponse.json(enriched)
    }

    // ── Legacy: basic URL enrichment (backward compatible) ──────
    if (body.url) {
      const urlRaw = typeof body.url === 'string' ? body.url.trim() : ''
      if (!urlRaw) {
        return NextResponse.json({ error: 'URL mancante' }, { status: 400 })
      }
      // Use Clay enrichment with minimal lead data
      const enriched = await clayEnrichLead({
        nome: '',
        sito: urlRaw,
      })
      // Return in legacy format for backward compatibility
      return NextResponse.json({
        linkedin_url: enriched.linkedinCompany || enriched.linkedinPerson || null,
        instagram_url: enriched.instagram || null,
        facebook_url: enriched.facebook || null,
        partita_iva: enriched.partitaIva || null,
        anno_fondazione: enriched.dataCostutuzione?.slice(0, 4) || null,
        dipendenti_stimati: enriched.dipendenti || null,
        // New fields (ignored by old callers)
        clay_data: enriched,
      })
    }

    return NextResponse.json({ error: 'Specificare lead o url' }, { status: 400 })
  } catch (e: any) {
    console.error('[enrich-lead] error:', e)
    return NextResponse.json({
      linkedin_url: null,
      instagram_url: null,
      facebook_url: null,
      partita_iva: null,
      anno_fondazione: null,
      dipendenti_stimati: null,
      error: e.message || 'Errore enrichment',
    })
  }
}
