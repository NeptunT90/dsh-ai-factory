import type { PullOutcome, PushOutcome, ServerMemoryPayload } from './store.js'

export interface SyncStore {
  push(deviceId: string, operations: Array<{
    opId: string
    entityId: string
    operation: 'upsert' | 'delete'
    baseVersion: number | null
    payload: ServerMemoryPayload
  }>): Promise<PushOutcome>
  pull(since: string, limit?: number): Promise<PullOutcome>
  health(): Promise<{ ok: true; vector: boolean; memories: number; operations: number }>
  dump?(): Promise<Uint8Array>
  backupManifest?(): Promise<{ schemaVersion: number; tables: Array<{ name: string; rows: number; sha256: string }> }>
  close(): Promise<void>
}
