import type { ResolvedConfig } from '../config.js'
import { FactoryError, errorMessage } from '../core/errors.js'
import { newId, now } from '../core/ids.js'
import type { AuditLog } from '../core/audit.js'
import type { MemoryEngine } from '../memory/engine.js'
import type { FactoryDatabase } from '../storage/database.js'
import type {
  OutboxRow,
  RemoteMemoryPayload,
  SyncPullResult,
  SyncPushResult,
  SyncStatus,
} from './types.js'

interface OutboxDbRow {
  op_id: string
  entity_id: string
  operation: 'upsert' | 'delete'
  payload: string
  base_version: number | null
  created_at: number
  attempts: number
  next_attempt_at: number | null
  last_error: string | null
}

interface PushResponse {
  accepted?: string[]
  conflicts?: Array<{ opId?: string; op_id?: string; entityId?: string; reason?: string }>
  rejected?: Array<{ opId?: string; op_id?: string; reason?: string }>
}

interface PullResponse {
  changes?: Array<{ opId?: string; payload?: RemoteMemoryPayload }>
  cursor?: string
}

function parsePayload(text: string): RemoteMemoryPayload {
  return JSON.parse(text) as RemoteMemoryPayload
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FactoryError('INVALID_INPUT', `syncUrl не является URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FactoryError('INVALID_INPUT', 'syncUrl должен быть http(s)')
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new FactoryError('INVALID_INPUT', 'HTTP sync разрешён только для loopback; используйте HTTPS')
  }
  return url.toString().replace(/\/+$/, '')
}

/** Local outbox and HTTP client for memory synchronization. */
export class SyncService {
  constructor(
    private readonly db: FactoryDatabase,
    private readonly memory: MemoryEngine,
    private readonly audit: AuditLog,
    private readonly config: ResolvedConfig,
  ) {}

  get configured(): boolean {
    return this.config.syncUrl.trim() !== ''
  }

  get deviceId(): string {
    const configured = this.config.syncDeviceId.trim()
    if (configured) return configured
    const existing = this.getState('device_id')
    if (existing) return existing
    const id = `dev_${newId('evt').slice(4)}`
    this.setState('device_id', id)
    return id
  }

  get cursor(): string {
    return this.getState('cursor') ?? ''
  }

  status(): SyncStatus {
    const pending = this.db.get<{ n: number }>(
      'SELECT count(*) AS n FROM sync_outbox WHERE sent_at IS NULL',
    )?.n ?? 0
    const failed = this.db.get<{ n: number }>(
      'SELECT count(*) AS n FROM sync_outbox WHERE sent_at IS NULL AND last_error IS NOT NULL',
    )?.n ?? 0
    return {
      configured: this.configured,
      url: this.config.syncUrl,
      tokenPresent: this.token() !== undefined,
      deviceId: this.deviceId,
      cursor: this.cursor,
      pending,
      failed,
      lastError:
        this.db.get<{ last_error: string | null }>(
          'SELECT last_error FROM sync_outbox WHERE sent_at IS NULL AND last_error IS NOT NULL ORDER BY attempts DESC LIMIT 1',
        )?.last_error ?? '',
    }
  }

  async push(): Promise<SyncPushResult> {
    const url = this.requireUrl()
    const token = this.requireToken()
    const pending = this.pendingRows(this.config.syncBatchSize)
    if (pending.length === 0) {
      return { pushed: 0, accepted: 0, conflicts: 0, failed: 0, pending: this.pendingCount() }
    }
    const body = {
      protocol: 1,
      deviceId: this.deviceId,
      operations: pending.map((row) => ({
        opId: row.opId,
        entityId: row.entityId,
        operation: row.operation,
        baseVersion: row.baseVersion,
        payload: row.payload,
      })),
    }
    let response: PushResponse
    try {
      response = await this.request<PushResponse>(url, '/v1/sync/push', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      const message = errorMessage(error)
      for (const row of pending) this.markFailure(row.opId, message)
      this.audit.record({
        event: 'sync.push_failed',
        level: 'warn',
        data: { count: pending.length, error: message.slice(0, 500) },
      })
      throw error
    }
    const accepted = new Set(response.accepted ?? [])
    let acceptedCount = 0
    let conflicts = 0
    let failed = 0
    for (const row of pending) {
      if (accepted.has(row.opId)) {
        this.markSent(row.opId)
        acceptedCount += 1
      } else {
        const conflict = (response.conflicts ?? []).find((entry) => (entry.opId ?? entry.op_id) === row.opId)
        if (conflict) {
          conflicts += 1
          this.markFailure(row.opId, conflict.reason ?? 'conflict')
        } else {
          failed += 1
          const reject = (response.rejected ?? []).find((entry) => (entry.opId ?? entry.op_id) === row.opId)
          this.markFailure(row.opId, reject?.reason ?? 'not accepted by server')
        }
      }
    }
    this.audit.record({
      event: 'sync.push',
      level: conflicts + failed > 0 ? 'warn' : 'info',
      data: { pushed: pending.length, accepted: acceptedCount, conflicts, failed, deviceId: this.deviceId },
    })
    return {
      pushed: pending.length,
      accepted: acceptedCount,
      conflicts,
      failed,
      pending: this.pendingCount(),
    }
  }

  async pull(): Promise<SyncPullResult> {
    const url = this.requireUrl()
    const token = this.requireToken()
    const since = this.cursor
    const query = `?since=${encodeURIComponent(since)}&deviceId=${encodeURIComponent(this.deviceId)}`
    const response = await this.request<PullResponse>(url, `/v1/sync/pull${query}`, token, { method: 'GET' })
    let applied = 0
    let skipped = 0
    for (const change of response.changes ?? []) {
      if (!change.payload) {
        skipped += 1
        continue
      }
      if (this.memory.applyRemote(change.payload)) applied += 1
      else skipped += 1
    }
    if (typeof response.cursor === 'string' && response.cursor !== '') {
      this.setState('cursor', response.cursor)
    }
    this.audit.record({
      event: 'sync.pull',
      level: 'info',
      data: { applied, skipped, cursor: response.cursor ?? since, deviceId: this.deviceId },
    })
    return { applied, skipped, cursor: this.cursor }
  }

  async sync(): Promise<{ push: SyncPushResult; pull: SyncPullResult }> {
    const push = await this.push()
    const pull = await this.pull()
    return { push, pull }
  }

  pendingCount(): number {
    return this.db.get<{ n: number }>(
      "SELECT count(*) AS n FROM sync_outbox WHERE sent_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      [now()],
    )?.n ?? 0
  }

  private pendingRows(limit: number): OutboxRow[] {
    return this.db
      .all<OutboxDbRow>(
        `SELECT op_id, entity_id, operation, payload, base_version, created_at, attempts, next_attempt_at, last_error
         FROM sync_outbox
         WHERE sent_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC LIMIT ?`,
        [now(), Math.max(1, Math.min(200, limit))],
      )
      .map((row) => ({
        opId: row.op_id,
        entityId: row.entity_id,
        operation: row.operation,
        payload: parsePayload(row.payload),
        baseVersion: row.base_version,
        createdAt: row.created_at,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        lastError: row.last_error,
      }))
  }

  private markSent(opId: string): void {
    this.db.run('UPDATE sync_outbox SET sent_at = ?, last_error = NULL, next_attempt_at = NULL WHERE op_id = ?', [
      now(),
      opId,
    ])
  }

  private markFailure(opId: string, error: string): void {
    const row = this.db.get<{ attempts: number }>('SELECT attempts FROM sync_outbox WHERE op_id = ?', [opId])
    const attempts = (row?.attempts ?? 0) + 1
    const delay = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(6, attempts))
    this.db.run(
      'UPDATE sync_outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE op_id = ?',
      [attempts, error.slice(0, 1000), now() + delay, opId],
    )
  }

  private token(): string | undefined {
    const envName = this.config.syncTokenEnv.trim()
    if (envName === '') return undefined
    const token = process.env[envName]?.trim()
    return token && token !== '' ? token : undefined
  }

  private requireToken(): string {
    const token = this.token()
    if (!token) {
      throw new FactoryError(
        'UNAVAILABLE',
        `Sync token не найден. Задайте переменную окружения ${this.config.syncTokenEnv} для DSH.`,
      )
    }
    return token
  }

  private requireUrl(): string {
    if (!this.configured) throw new FactoryError('UNAVAILABLE', 'Синхронизация не настроена: syncUrl пуст')
    return normalizeBaseUrl(this.config.syncUrl)
  }

  private async request<T>(
    base: string,
    path: string,
    token: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.config.syncTimeoutMs),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new FactoryError('UNAVAILABLE', `Sync server ${response.status}: ${text.slice(0, 300)}`)
    }
    return (await response.json()) as T
  }

  private getState(key: string): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key])?.value
  }

  private setState(key: string, value: string): void {
    this.db.run(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, now()],
    )
  }
}
