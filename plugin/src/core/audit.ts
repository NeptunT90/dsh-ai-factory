import type { FactoryDatabase } from '../storage/database.js'
import { newId, now } from '../core/ids.js'
import { redactSecrets } from '../core/security.js'

export type AuditLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AuditInput {
  readonly event: string
  readonly level?: AuditLevel
  readonly actor?: string
  readonly projectId?: string | null
  readonly sessionId?: string | null
  readonly data?: Record<string, unknown>
}

export interface AuditRecord {
  readonly id: string
  readonly ts: number
  readonly level: AuditLevel
  readonly event: string
  readonly actor: string | null
  readonly projectId: string | null
  readonly sessionId: string | null
  readonly data: Record<string, unknown>
}

interface AuditRow {
  id: string
  ts: number
  level: AuditLevel
  event: string
  actor: string | null
  project_id: string | null
  session_id: string | null
  data: string
}

/** Durable audit trail. Never stores full memory content or credentials. */
export class AuditLog {
  constructor(
    private readonly db: FactoryDatabase,
    private readonly redact: boolean,
  ) {}

  record(input: AuditInput): void {
    try {
      const data = this.redact ? redactSecrets(JSON.stringify(input.data ?? {})) : JSON.stringify(input.data ?? {})
      this.db.run(
        `INSERT INTO audit_log (id, ts, level, event, actor, project_id, session_id, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('aud'),
          now(),
          input.level ?? 'info',
          input.event.slice(0, 200),
          input.actor?.slice(0, 200) ?? null,
          input.projectId ?? null,
          input.sessionId ?? null,
          data,
        ],
      )
    } catch {
      // Audit failure must not break the user's operation; the host logger still
      // records startup and tool errors.
    }
  }

  count(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM audit_log')?.n ?? 0
  }

  /** Read the newest audit records for the dashboard. */
  recent(limit = 50): AuditRecord[] {
    const capped = Math.max(1, Math.min(200, Math.floor(limit)))
    return this.db
      .all<AuditRow>(
        `SELECT id, ts, level, event, actor, project_id, session_id, data
         FROM audit_log ORDER BY ts DESC LIMIT ?`,
        [capped],
      )
      .map((row) => {
        let data: Record<string, unknown> = {}
        try {
          const parsed: unknown = JSON.parse(row.data)
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed as Record<string, unknown>
          }
        } catch {
          data = {}
        }
        return {
          id: row.id,
          ts: row.ts,
          level: row.level,
          event: row.event,
          actor: row.actor,
          projectId: row.project_id,
          sessionId: row.session_id,
          data,
        }
      })
  }
}
