import { createHash, randomUUID } from 'node:crypto'

/** Branded id helpers; all ids are opaque strings. */
export function newId(prefix: 'mem' | 'prj' | 'tsk' | 'aud' | 'evt' | 'agt'): string {
  return `${prefix}_${randomUUID()}`
}

/** SHA-256 hex digest. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Stable short id derived from an absolute workspace path. */
export function projectIdForPath(absolutePath: string): string {
  const canonical = absolutePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return `prj_${sha256(canonical).slice(0, 16)}`
}

/** Unix epoch milliseconds. */
export function now(): number {
  return Date.now()
}
