import type { LeadChange } from './types'

const WATCH_FIELDS: Array<[string, string]> = [
  ['meta_pixel', 'Meta Pixel'],
  ['google_tag_manager', 'Google Tag Manager'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['sito', 'Sito Web'],
  ['email', 'Email'],
]

/** Confronta due snapshot lead (allineato a worker `_detect_changes`). */
export function detectLeadChanges(
  oldLead: Record<string, unknown>,
  newLead: Record<string, unknown>,
  nowIso = new Date().toISOString(),
): LeadChange[] {
  const changes: LeadChange[] = []

  for (const [field, label] of WATCH_FIELDS) {
    const oldVal = Boolean(oldLead[field])
    const newVal = Boolean(newLead[field])
    if (oldVal !== newVal) {
      changes.push({
        field,
        label,
        from: oldVal,
        to: newVal,
        detected_at: nowIso,
        signal: `${label} ${newVal ? 'installato' : 'rimosso'}`,
      })
    }
  }

  const oldRating = oldLead.rating
  const newRating = newLead.rating
  if (typeof oldRating === 'number' && typeof newRating === 'number') {
    const diff = newRating - oldRating
    if (Math.abs(diff) >= 0.3) {
      changes.push({
        field: 'rating',
        label: 'Rating Google',
        from: oldRating,
        to: newRating,
        detected_at: nowIso,
        signal: `Rating Google ${diff > 0 ? 'salito' : 'sceso'} (${oldRating} → ${newRating})`,
      })
    }
  }

  return changes
}
