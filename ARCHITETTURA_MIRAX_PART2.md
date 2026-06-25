# MIRAX CKB — Architettura Completa (Parte 2/3)

## 4. Flusso Principale: Ricerca → Scraping → Risultati

```
1. Utente compila form su /dashboard: categoria + città → POST /api/search
2. API crea riga in searches (status=pending, user_id=X)
3. Worker Python (polling ogni 4s) rileva job pending
4. Worker fa claim atomico: UPDATE status=processing WHERE status=pending
5. Playwright apre Google Maps, cerca "categoria vicino a città"
6. Estrae 20 risultati (nome, indirizzo, telefono, sito, rating, recensioni)
7. Per ogni lead con sito web: audit tecnico (SSL, mobile, pixel, GTM, speed, etc.)
8. Arricchisce con recensioni Google + competitor locali (Playwright)
9. Worker scrive results JSONB in searches, status=completed
10. Frontend fa polling GET /api/search/status finché status != pending/processing
11. Risultati mostrati in tabella su /dashboard
```

---

## 5. Tipi TypeScript Fondamentali

### Lead (da Google Maps scraping)
```typescript
interface LeadResult {
  azienda: string
  telefono: string
  email: string | null
  sito: string | null
  website: string | null
  citta: string
  tech_stack: string[]
  rating: number | null
  reviews_count: number
  is_claimed: boolean | null
  instagram: string | null
  facebook: string | null
  meta_ads_library: string | null
  decision_maker: string
  meta_pixel: boolean
  google_tag_manager: boolean
  html_errors: number
  technical_report: TechnicalReport
  last_audited_at: string
  freshness_score: number
  opportunity_score: number
  audit_version: number
  google_reviews: GoogleReview[]
  local_competitors: LocalCompetitor[]
}
```

### TechnicalReport
```typescript
interface TechnicalReport {
  html_errors: number
  load_speed_s: number | null
  load_speed_seconds: number | null
  error_details: string[]
  has_google_ads: boolean
  has_ga4: boolean
  has_chatbot: boolean
  has_booking_system: boolean
  has_ecommerce: boolean
  has_spf: boolean
  has_dmarc: boolean
  seo_disaster: boolean
}
```

### ClayEnrichedLead (arricchimento completo)
```typescript
interface ClayEnrichedLead {
  // Dati anagrafici
  nome: string; telefono: string; email: string | null; sito: string | null
  citta: string; indirizzo: string | null; categoria: string | null

  // Registro Imprese
  partitaIva: string | null; codiceFiscale: string | null
  dataCostutuzione: string | null; formaGiuridica: string | null
  dipendenti: string | null; capitaleSociale: string | null
  fatturato: string | null; utile: string | null

  // LinkedIn
  linkedinCompany: string | null; linkedinCompanyDescription: string | null
  linkedinPerson: string | null; linkedinPersonName: string | null
  linkedinPersonTitle: string | null

  // Social
  instagram: string | null; instagramHandle: string | null
  facebook: string | null; tiktok: string | null; youtube: string | null

  // PEC
  pec: string | null

  // Tech
  techStack: string[]; technicalReport: TechnicalReport

  // Score
  opportunityScore: number; freshnessScore: number

  // Google
  googleReviews: GoogleReview[]; googleRating: number | null
  googleReviewsCount: number; isClaimed: boolean | null
  googleDescription: string | null

  // Competitor
  localCompetitors: LocalCompetitor[]; competitorAnalysis: CompetitorAnalysis | null

  // Ads
  adsAnalysis: AdsAnalysis | null

  // Trends
  trendsAnalysis: TrendsAnalysis | null

  // Social analysis
  socialAnalysis: SocialAnalysis | null

  // Registry
  registryAnalysis: RegistryAnalysis | null

  // Meta
  sources: string[]; enrichedAt: string
}
```

### PipelineItem
```typescript
interface PipelineItem {
  id: string
  lead_name: string
  lead_category: string | null
  lead_city: string | null
  lead_phone: string | null
  lead_email: string | null
  lead_website: string | null
  lead_score: number
  lead_data: ClayEnrichedLead | null
  stage: 'nuovo' | 'contattato' | 'trattativa' | 'vinto' | 'perso'
  deal_value: number
  notes: string
  created_at: string
  updated_at: string
}
```

### GoogleReview
```typescript
interface GoogleReview { text: string; stars: number }
```

### LocalCompetitor
```typescript
interface LocalCompetitor {
  name: string; rating: number | null; reviews_count: number | null
}
```

### CompetitorAnalysis
```typescript
interface CompetitorAnalysis {
  overallCompetitionScore: number
  competitors: LocalCompetitor[]
  marketPosition: {
    summary: string; strengths: string[]; weaknesses: string[]
    suggestedAngle: string; threatLevel: 'low' | 'medium' | 'high'
  }
  opportunities: string[]
  urgencyMessage: string
}
```

### AdsAnalysis
```typescript
interface AdsAnalysis {
  facebookAds: { isRunning: boolean; estimatedBudget: string | null; adTypes: string[]; since: string | null; totalAds: number; libraryUrl: string }
  googleAds: { isRunning: boolean; keywords: string[]; estimatedBudget: string | null }
  overallAdScore: number
  opportunities: string[]
  competitorContext: string
}
```

### TrendsAnalysis
```typescript
interface TrendsAnalysis {
  trend: 'growing' | 'stable' | 'declining'
  growthPercentage: number | null
  peakMonths: string[]
  bestContactTime: string
  marketOpportunity: string
  insights: string[]
  source: 'pytrends' | 'gpt' | 'error'
}
```

### SocialAnalysis
```typescript
interface SocialAnalysis {
  instagram: { handle: string | null; followers: number | null; lastPost: string | null; engagement: string | null; hasLink: boolean }
  facebook: { url: string | null; followers: number | null; lastPost: string | null; isActive: boolean }
  tiktok: { handle: string | null; followers: number | null; hasPresence: boolean }
  linkedin: { url: string | null; employees: number | null; hasPresence: boolean }
  overallScore: number
  missingPlatforms: string[]
  inactiveplatforms: string[]
  opportunities: string[]
}
```

### RegistryAnalysis
```typescript
interface RegistryAnalysis {
  foundedYear: number | null
  legalForm: string | null
  employees: string | null
  revenue: string | null
  insights: string[]
}
```

---

## 6. Worker Python — Dettaglio

### Main Loop (`worker_supabase.py`)
```python
while True:
    time.sleep(random.uniform(1.0, 5.0))  # desync workers
    
    # Priority 1: user jobs (recent)
    rows = supabase.table("searches").select("*") \
        .eq("status", "pending").order("created_at", desc=True).limit(1).execute()
    
    # Fallback: backlog jobs
    if not rows:
        rows = supabase.table("searches").select("*") \
            .eq("status", "pending").order("created_at", desc=True).limit(1).execute()
    
    if not rows: time.sleep(4); continue
    
    job = rows[0]
    
    # Atomic claim
    claim = supabase.table("searches").update({"status":"processing","results":None}) \
        .eq("id", job_id).eq("status","pending").execute()
    if not claim.data: continue  # già preso
    
    # Esegui scraping
    core_results = asyncio.run(_run_core_scraper(category, location, zone, ...))
    formatted = _format_results(core_results)
    
    # Scrivi risultato
    supabase.table("searches").update({"status":"completed","results":formatted}) \
        .eq("id", job_id).execute()
    
    time.sleep(cooldown_s)
```

### Cosa fa `_run_core_scraper`:
1. Chiama `scrape_google_maps_playwright(category, location)` → Playwright
2. Per ogni lead con sito: `audit_website_with_status(website)` → audit tecnico
3. `run_technical_audit(website)` → analisi HTML, SEO, email security
4. `deep_scrape_mobile_from_website(website)` → cerca cellulare nel sito
5. `_scrape_reviews_and_competitors()` → recensioni + competitor via Playwright
6. Calcola `opportunity_score` (0-100) e `freshness_score` (0-100)
7. Detecta cambiamenti vs audit precedente (`_detect_changes`)

### Campi tracciati per changes:
- Meta Pixel (installato/rimosso)
- Google Tag Manager
- Instagram, Facebook
- Sito Web (creato/offline)
- Email
- Rating Google (variazioni ≥ 0.3)

### Opportunity Score (0-100):
- +25: no Meta Pixel
- +30: no sito web
- +10: no Instagram
- +15: disastro SEO
- +10: no DMARC
- +5: no mobile / sito lento (>4s)
- +20: rating < 3.5
- +10: rating < 4.0
- +5: < 10 recensioni
