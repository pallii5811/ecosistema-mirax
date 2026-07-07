/**
 * Universe error codes and helpers.
 */

export type UniverseErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_ALREADY_EXISTS'
  | 'ALIAS_NOT_FOUND'
  | 'OBSERVATION_INVALID'
  | 'RELATIONSHIP_INVALID'
  | 'EVENT_INVALID'
  | 'CANONICAL_ID_MISSING'
  | 'DATABASE_ERROR'
  | 'INVALID_OPERATOR'
  | 'MERGE_SELF'
  | 'MERGE_MISSING'
  | 'MERGE_ALREADY'
  | 'UNKNOWN_ERROR'

export class UniverseError extends Error {
  code: UniverseErrorCode
  cause?: unknown

  constructor(code: UniverseErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'UniverseError'
    this.code = code
    this.cause = cause
  }
}

export function isUniverseError(error: unknown): error is UniverseError {
  return error instanceof UniverseError
}

export function wrapSupabaseError(error: unknown, fallbackCode: UniverseErrorCode = 'DATABASE_ERROR'): UniverseError {
  if (isUniverseError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return new UniverseError(fallbackCode, message, error)
}

/**
 * Restituisce un messaggio di errore sicuro da esporre al client.
 * Logga il dettaglio reale server-side.
 */
export function universeClientError(error: unknown, context: string): { message: string; status: number } {
  const internal = error instanceof Error ? error.message : String(error)
  console.error(`[universe:${context}]`, internal)

  if (error instanceof UniverseError) {
    switch (error.code) {
      case 'ENTITY_NOT_FOUND':
        return { message: error.message, status: 404 }
      case 'CANONICAL_ID_MISSING':
      case 'INVALID_OPERATOR':
      case 'OBSERVATION_INVALID':
      case 'RELATIONSHIP_INVALID':
      case 'EVENT_INVALID':
        return { message: error.message, status: 400 }
      default:
        break
    }
  }

  return { message: 'Errore interno. Riprova più tardi.', status: 500 }
}
