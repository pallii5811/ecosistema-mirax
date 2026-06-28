/**
 * Pitch Agent — generazione pitch commerciale (delega a server action).
 */

import { generatePitchAction, type PitchInput } from '@/app/dashboard/actions'

export async function runPitchAgent(input: PitchInput) {
  const result = await generatePitchAction(input)
  return { ok: true as const, ...result }
}
