import type { SupabaseClient } from '@supabase/supabase-js'
import {
  adjustWeightsFromFeedback,
  outreachStatusToFeedbackOutcome,
  pipelineStageToFeedbackOutcome,
  type ScoringFeedbackSample,
} from '@/lib/adaptive-scoring'
import type { ScoringWeights } from '@/types/scoring'

const DEFAULT_WEIGHTS: ScoringWeights = {
  weight_no_pixel: 25,
  weight_no_gtm: 15,
  weight_no_ssl: 10,
  weight_has_email: 20,
  weight_seo_errors: 15,
  weight_slow_speed: 10,
  weight_no_google_ads: 5,
}

async function insertInteraction(
  supabase: SupabaseClient,
  userId: string,
  website: string,
  name: string | null,
  action: string,
  scoreAtTime: number | null,
) {
  await supabase.from('lead_interactions').insert({
    user_id: userId,
    lead_website: website,
    lead_nome: name,
    action,
    score_at_time: scoreAtTime,
  })
}

export async function recordOutreachScoringFeedback(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    website?: string | null
    name?: string | null
    status: string
    scoreAtTime?: number | null
  },
): Promise<void> {
  const website = typeof opts.website === 'string' && opts.website.trim() ? opts.website.trim() : ''
  if (!website) return

  const outcome = outreachStatusToFeedbackOutcome(opts.status)
  const st = opts.status.trim().toLowerCase()

  if (st === 'sent') {
    await insertInteraction(supabase, userId, website, opts.name ?? null, 'contacted', opts.scoreAtTime ?? null)
  } else if (outcome === 'positive') {
    await insertInteraction(supabase, userId, website, opts.name ?? null, 'contacted', opts.scoreAtTime ?? null)
  } else if (outcome === 'negative') {
    await insertInteraction(supabase, userId, website, opts.name ?? null, 'rejected', opts.scoreAtTime ?? null)
  }

  if (outcome) {
    await retrainUserScoringModel(supabase, userId)
  }
}

export async function recordPipelineStageFeedback(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    website?: string | null
    name?: string | null
    stage: string
    scoreAtTime?: number | null
  },
): Promise<void> {
  const website = typeof opts.website === 'string' && opts.website.trim() ? opts.website.trim() : ''
  if (!website) return

  const outcome = pipelineStageToFeedbackOutcome(opts.stage)
  if (outcome === 'positive') {
    await insertInteraction(supabase, userId, website, opts.name ?? null, 'converted', opts.scoreAtTime ?? null)
    await retrainUserScoringModel(supabase, userId)
  } else if (outcome === 'negative') {
    await insertInteraction(supabase, userId, website, opts.name ?? null, 'rejected', opts.scoreAtTime ?? null)
    await retrainUserScoringModel(supabase, userId)
  }
}

/** Ricalibra pesi personalizzati da lead_interactions + outreach_log recenti. */
export async function retrainUserScoringModel(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const samples: ScoringFeedbackSample[] = []

  const { data: interactions } = await supabase
    .from('lead_interactions')
    .select('action, score_at_time')
    .eq('user_id', userId)
    .in('action', ['converted', 'rejected', 'contacted'])
    .order('created_at', { ascending: false })
    .limit(80)

  for (const row of interactions ?? []) {
    const action = String((row as any).action ?? '')
    const score = Number((row as any).score_at_time)
    const scoreAtTime = Number.isFinite(score) ? score : null
    if (action === 'converted') samples.push({ outcome: 'positive', scoreAtTime })
    if (action === 'rejected') samples.push({ outcome: 'negative', scoreAtTime })
  }

  const { data: outreach } = await supabase
    .from('outreach_log')
    .select('status, lead_website')
    .eq('user_id', userId)
    .in('status', ['interested', 'not_interested', 'replied'])
    .order('created_at', { ascending: false })
    .limit(100)

  for (const row of outreach ?? []) {
    const outcome = outreachStatusToFeedbackOutcome(String((row as any).status ?? ''))
    if (!outcome) continue
    samples.push({ outcome, scoreAtTime: null })
  }

  const { data: pipeline } = await supabase
    .from('lead_pipeline')
    .select('stage, lead_score')
    .eq('user_id', userId)
    .in('stage', ['vinto', 'perso'])
    .order('updated_at', { ascending: false })
    .limit(50)

  for (const row of pipeline ?? []) {
    const outcome = pipelineStageToFeedbackOutcome(String((row as any).stage ?? ''))
    if (!outcome) continue
    const score = Number((row as any).lead_score)
    samples.push({
      outcome,
      scoreAtTime: Number.isFinite(score) ? score : null,
    })
  }

  if (samples.length < 5) return

  const { data: model } = await supabase
    .from('user_scoring_models')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  const base: ScoringWeights = model
    ? {
        weight_no_pixel: Number((model as any).weight_no_pixel ?? DEFAULT_WEIGHTS.weight_no_pixel),
        weight_no_gtm: Number((model as any).weight_no_gtm ?? DEFAULT_WEIGHTS.weight_no_gtm),
        weight_no_ssl: Number((model as any).weight_no_ssl ?? DEFAULT_WEIGHTS.weight_no_ssl),
        weight_has_email: Number((model as any).weight_has_email ?? DEFAULT_WEIGHTS.weight_has_email),
        weight_seo_errors: Number((model as any).weight_seo_errors ?? DEFAULT_WEIGHTS.weight_seo_errors),
        weight_slow_speed: Number((model as any).weight_slow_speed ?? DEFAULT_WEIGHTS.weight_slow_speed),
        weight_no_google_ads: Number(
          (model as any).weight_no_google_ads ?? DEFAULT_WEIGHTS.weight_no_google_ads,
        ),
      }
    : { ...DEFAULT_WEIGHTS }

  const adjusted = adjustWeightsFromFeedback(base, samples)
  const conversions = samples.filter((s) => s.outcome === 'positive').length
  const rejections = samples.filter((s) => s.outcome === 'negative').length

  await supabase.from('user_scoring_models').upsert(
    {
      user_id: userId,
      ...adjusted,
      total_conversions: conversions,
      total_rejections: rejections,
      last_trained_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
}
