export class ResearchBudgetExceededError extends Error {
  readonly code = 'RESEARCH_HARD_BUDGET_EXCEEDED'
}

export type CostReservation = {
  idempotencyKey: string
  operationType: string
  estimatedMicroEur: number
  actualMicroEur?: number
  status: 'reserved' | 'settled' | 'released' | 'failed'
}

const toMicroEur = (eur: number) => Math.max(0, Math.round(eur * 1_000_000))
const fromMicroEur = (value: number) => value / 1_000_000

export class ResearchCostGovernor {
  readonly targetMicroEur: number
  readonly hardMicroEur: number
  private readonly reservations = new Map<string, CostReservation>()

  constructor(targetCostEur: number, hardCostEur: number) {
    this.targetMicroEur = toMicroEur(targetCostEur)
    this.hardMicroEur = toMicroEur(hardCostEur)
    if (this.hardMicroEur <= 0 || this.targetMicroEur > this.hardMicroEur) {
      throw new TypeError('Invalid research budget')
    }
  }

  get committedMicroEur(): number {
    return [...this.reservations.values()].reduce((sum, item) => {
      if (item.status === 'released' || item.status === 'failed') return sum
      return sum + (item.actualMicroEur ?? item.estimatedMicroEur)
    }, 0)
  }

  get committedCostEur(): number {
    return fromMicroEur(this.committedMicroEur)
  }

  get strategy(): 'normal' | 'economy' | 'hard_stop' {
    if (this.committedMicroEur >= this.hardMicroEur) return 'hard_stop'
    if (this.committedMicroEur >= this.targetMicroEur) return 'economy'
    return 'normal'
  }

  canReserve(estimatedCostEur: number): boolean {
    return this.committedMicroEur + toMicroEur(estimatedCostEur) <= this.hardMicroEur
  }

  reserve(idempotencyKey: string, operationType: string, estimatedCostEur: number): CostReservation {
    const existing = this.reservations.get(idempotencyKey)
    if (existing) return existing
    const estimatedMicroEur = toMicroEur(estimatedCostEur)
    if (this.committedMicroEur + estimatedMicroEur > this.hardMicroEur) {
      throw new ResearchBudgetExceededError(
        `Operation ${operationType} would exceed hard budget (${this.hardMicroEur} micro-EUR)`,
      )
    }
    const reservation: CostReservation = {
      idempotencyKey,
      operationType,
      estimatedMicroEur,
      status: 'reserved',
    }
    this.reservations.set(idempotencyKey, reservation)
    return reservation
  }

  settle(idempotencyKey: string, actualCostEur: number): CostReservation {
    const reservation = this.reservations.get(idempotencyKey)
    if (!reservation) throw new TypeError(`Unknown reservation ${idempotencyKey}`)
    if (reservation.status === 'settled') return reservation
    const actualMicroEur = toMicroEur(actualCostEur)
    const withoutCurrent = this.committedMicroEur - (reservation.actualMicroEur ?? reservation.estimatedMicroEur)
    const remainingForActual = this.hardMicroEur - withoutCurrent
    // Clamp: never let settled+reservations exceed hard_cap (S1 €0.0656 class).
    const clamped = Math.min(actualMicroEur, Math.max(0, remainingForActual))
    if (actualMicroEur > remainingForActual) {
      reservation.actualMicroEur = clamped
      reservation.status = 'settled'
      throw new ResearchBudgetExceededError(
        'Actual operation cost exceeded hard budget; settled clamped; termination=partial_budget_exhausted',
      )
    }
    reservation.actualMicroEur = clamped
    reservation.status = 'settled'
    return reservation
  }

  release(idempotencyKey: string): void {
    const reservation = this.reservations.get(idempotencyKey)
    if (reservation) reservation.status = 'released'
  }

  snapshot() {
    return {
      target_cost_eur: fromMicroEur(this.targetMicroEur),
      hard_cost_eur: fromMicroEur(this.hardMicroEur),
      committed_cost_eur: this.committedCostEur,
      strategy: this.strategy,
      operations: [...this.reservations.values()].map((item) => ({ ...item })),
    }
  }
}
