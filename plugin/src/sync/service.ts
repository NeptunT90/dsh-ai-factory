import { readFileSync } from 'node:fs'
import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { expandPath, type ResolvedConfig } from '../config.js'
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

function isPrivateLanHost(hostname: string): boolean {
  const octets = hostname.split('.').map((part) => Number(part))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [first, second] = octets
  return first === 10 || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168)
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
  if (url.protocol === 'http:' && !isLoopback(url.hostname) && !isPrivateLanHost(url.hostname)) {
    throw new FactoryError('INVALID_INPUT', 'HTTP sync разрешён только для loopback/private LAN; используйте HTTPS')
  }
  return url.toString().replace(/\/+$/, '')
}

/** Local outbox and HTTP client for memory synchronization. */
export class SyncService {
  private autoTimer: ReturnType<typeof setInterval> | undefined
  private syncing = false

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
      auto: this.autoTimer !== undefined,
      running: this.syncing,
      lastSyncAt: Number(this.getState('last_sync_at') ?? 0),
      lastSyncError: this.getState('last_sync_error') ?? '',
    }
  }

  /** Start periodic push+pull while the plugin is alive. */
  startAuto(intervalMs?: number): void {
    if (this.autoTimer !== undefined) return
    if (!this.configured) return
    const interval = intervalMs === undefined
      ? Math.max(15_000, Math.min(86_400_000, this.config.syncIntervalSeconds * 1000))
      : Math.max(100, Math.min(86_400_000, intervalMs))
    this.autoTimer = setInterval(() => void this.autoTick(), interval)
    this.autoTimer.unref?.()
    this.audit.record({ event: 'sync.auto_started', level: 'info', data: { intervalMs: interval } })
  }

  stopAuto(): void {
    if (this.autoTimer !== undefined) {
      clearInterval(this.autoTimer)
      this.autoTimer = undefined
      this.audit.record({ event: 'sync.auto_stopped', level: 'info', data: {} })
    }
  }

  private async autoTick(): Promise<void> {
    if (this.syncing || !this.configured || this.db.isClosed) return
    this.syncing = true
    try {
      await this.sync()
    } catch (error) {
      if (this.db.isClosed) return
      try {
        this.setState('last_sync_error', errorMessage(error).slice(0, 1000))
        this.audit.record({
          event: 'sync.auto_failed',
          level: 'warn',
          data: { error: errorMessage(error).slice(0, 500) },
        })
      } catch {
        // The plugin may have unloaded while a network request was in flight.
      }
    } finally {
      this.syncing = false
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
    this.setState('last_sync_at', String(now()))
    this.setState('last_sync_error', '')
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
    this.setState('last_sync_at', String(now()))
    this.setState('last_sync_error', '')
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
    if (token && token !== '') return token
    const tokenFile = this.config.syncTokenFile.trim()
    if (tokenFile !== '') {
      try {
        const fromFile = readFileSync(expandPath(tokenFile), 'utf8').trim()
        if (fromFile !== '') return fromFile
      } catch {
        // Fall through to the normal missing-token error.
      }
    }
    return undefined
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
    const target = new URL(`${base}${path}`)
    // DSH enables NODE_USE_ENV_PROXY; private-LAN sync must bypass the desktop HTTP proxy.
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? ''
    if (!noProxy.split(',').map((item) => item.trim()).includes(target.hostname)) {
      process.env.NO_PROXY = [noProxy, target.hostname].filter(Boolean).join(',')
      process.env.no_proxy = process.env.NO_PROXY
    }
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }
    const body = typeof init.body === 'string' ? init.body : undefined
    const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
      const agent = target.protocol === 'https:' ? new HttpsAgent({ keepAlive: false }) : new HttpAgent({ keepAlive: false })
      const req = requestFn(target, { method: init.method ?? 'GET', headers, agent }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      })
      req.setTimeout(this.config.syncTimeoutMs, () => req.destroy(new Error('sync request timeout')))
      req.on('error', reject)
      if (body !== undefined) req.write(body)
      req.end()
    })
    if (response.status < 200 || response.status >= 300) {
      throw new FactoryError('UNAVAILABLE', `Sync server ${response.status}: ${response.text.slice(0, 300)}`)
    }
    try {
      return JSON.parse(response.text) as T
    } catch {
      throw new FactoryError('UNAVAILABLE', 'Sync server returned invalid JSON')
    }
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
