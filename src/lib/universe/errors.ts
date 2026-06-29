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
