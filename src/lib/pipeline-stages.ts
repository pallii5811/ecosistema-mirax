/**
 * CKB pipeline — 6 stati concettuali allineati al funnel commerciale MIRAX.
 */

export const PIPELINE_STAGES = [
  'nuovo',
  'contattato',
  'meeting',
  'proposta',
  'vinto',
  'perso',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const STAGE_ORDER: Record<PipelineStage, number> = {
  nuovo: 0,
  contattato: 1,
  meeting: 2,
  proposta: 3,
  vinto: 4,
  perso: 4,
}

export const PIPELINE_STAGE_META: Record<
  PipelineStage,
  { label: string; description: string }
> = {
  nuovo: { label: 'Nuovo', description: 'Lead in pipeline, mai contattato' },
  contattato: { label: 'Contattato', description: 'Primo outreach inviato' },
  meeting: { label: 'Meeting', description: 'Risposta positiva o call fissata' },
  proposta: { label: 'Proposta', description: 'Offerta commerciale inviata' },
  vinto: { label: 'Vinto', description: 'Deal chiuso' },
  perso: { label: 'Perso', description: 'Opportunità archiviata' },
}

const TERMINAL: PipelineStage[] = ['vinto', 'perso']

export function sanitizePipelineStage(value: unknown): PipelineStage {
  return PIPELINE_STAGES.includes(value as PipelineStage) ? (value as PipelineStage) : 'nuovo'
}

export function isTerminalStage(stage: unknown): boolean {
  return TERMINAL.includes(sanitizePipelineStage(stage))
}

/** Mappa esito outreach → avanzamento stage (mai downgrade, salvo perso). */
export function outreachStatusToPipelineStage(
  outreachStatus: string,
  currentStage: unknown,
): PipelineStage | null {
  const cur = sanitizePipelineStage(currentStage)
  const st = outreachStatus.trim().toLowerCase()

  if (st === 'not_interested') return 'perso'
  if (st === 'interested' || st === 'replied') {
    if (STAGE_ORDER[cur] < STAGE_ORDER.meeting) return 'meeting'
    return null
  }
  if (st === 'sent' || st === 'no_answer') {
    if (cur === 'nuovo') return 'contattato'
    return null
  }
  return null
}

/** Unisce stage corrente con proposta (monotonicità verso avanti o terminali). */
export function mergePipelineStage(
  current: unknown,
  proposed: PipelineStage | null,
): PipelineStage {
  const cur = sanitizePipelineStage(current)
  if (!proposed) return cur
  if (proposed === 'perso' || proposed === 'vinto') return proposed
  if (isTerminalStage(cur)) return cur
  return STAGE_ORDER[proposed] > STAGE_ORDER[cur] ? proposed : cur
}

export function nextPipelineStage(current: unknown): PipelineStage | null {
  const cur = sanitizePipelineStage(current)
  if (isTerminalStage(cur)) return null
  const idx = PIPELINE_STAGES.indexOf(cur)
  if (idx < 0 || idx >= PIPELINE_STAGES.length - 2) return null
  return PIPELINE_STAGES[idx + 1]
}
