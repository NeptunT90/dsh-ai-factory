/** Stable error codes surfaced by AI Factory tools and diagnostics. */
export type FactoryErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PATH'
  | 'SECRET_DETECTED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_MISMATCH'
  | 'DUPLICATE_MEMORY'
  | 'PROJECT_REQUIRED'
  | 'PROJECT_MISMATCH'
  | 'SKILL_INVALID'
  | 'SKILL_TOO_LARGE'
  | 'SKILL_SECRET_DETECTED'
  | 'SKILL_LIMIT_EXCEEDED'
  | 'SKILL_NOT_FOUND'
  | 'CAPABILITY_MISSING'
  | 'KNOWLEDGE_INVALID'
  | 'KNOWLEDGE_TOO_LARGE'
  | 'KNOWLEDGE_UNSUPPORTED'
  | 'KNOWLEDGE_ENCRYPTED'
  | 'KNOWLEDGE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'STORAGE_UNAVAILABLE'
  | 'SQLITE_UNAVAILABLE'
  | 'UNAVAILABLE'
  | 'INTERNAL'

/** Error carrying a stable machine-readable code and optional safe details. */
export class FactoryError extends Error {
  readonly code: FactoryErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: FactoryErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'FactoryError'
    this.code = code
    this.details = details
  }
}

/** Convert an unknown thrown value into a safe one-line message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Convert an unknown thrown value into a FactoryError when it is not one already. */
export function asFactoryError(error: unknown, code: FactoryErrorCode = 'INTERNAL'): FactoryError {
  if (error instanceof FactoryError) return error
  return new FactoryError(code, errorMessage(error))
}
