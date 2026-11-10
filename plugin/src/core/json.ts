/** Lossless JSON value accepted by DSH tool schemas. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/**
 * Detach a value that was already serialized through JSON.stringify. This is a
 * boundary cast, not validation: callers only pass objects that survived the
 * store's lossless-JSON checks.
 */
export function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue
}
