/** Modalità UI MIRAX — Expert (agenzie) vs Discovery (imprenditori). */

export type MiraxUiMode = 'expert' | 'discovery'

export const UI_MODE_STORAGE_KEY = 'mirax_ui_mode'
export const FIRST_RUN_STORAGE_KEY = 'mirax_first_run_done'

export const UI_MODE_LABELS: Record<MiraxUiMode, { label: string; short: string; description: string }> = {
  expert: {
    label: 'Modalità Expert',
    short: 'Expert',
    description: 'Filtri tecnici, audit completo, tech stack — per agenzie e marketer.',
  },
  discovery: {
    label: 'Modalità Discovery',
    short: 'Discovery',
    description: 'Nome → Motivo → Pitch in linguaggio semplice — per imprenditori.',
  },
}

export function readUiMode(): MiraxUiMode {
  if (typeof window === 'undefined') return 'expert'
  try {
    const raw = localStorage.getItem(UI_MODE_STORAGE_KEY)
    return raw === 'discovery' ? 'discovery' : 'expert'
  } catch {
    return 'expert'
  }
}

export function writeUiMode(mode: MiraxUiMode): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(UI_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function isFirstRunPending(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return !localStorage.getItem(FIRST_RUN_STORAGE_KEY)
  } catch {
    return false
  }
}

export function markFirstRunDone(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FIRST_RUN_STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}
