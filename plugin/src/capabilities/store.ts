import { randomUUID } from 'node:crypto'
import type { FactoryDatabase } from '../storage/database.js'
import { now } from '../core/ids.js'
import type {
  CapabilityRecord,
  CapabilityScanRecord,
  CapabilityScope,
  CapabilityStatus,
  CapabilityVersionSource,
} from './types.js'

interface CapabilityRow {
  id: string
  scope: CapabilityScope
  project_id: string | null
  capability_id: string
  kind: string
  path: string | null
  version: string | null
  version_source: CapabilityVersionSource
  status: CapabilityStatus
  confidence: number
  details: string
  last_seen_at: number
  expires_at: number | null
  updated_at: number
}

interface ScanRow {
  id: string
  scope: CapabilityScope
  project_id: string | null
  status: 'RUNNING' | 'COMPLETE' | 'FAILED'
  scanner_version: string
  started_at: number
  finished_at: number | null
  counts: string
  error: string | null
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseCounts(value: string): Record<string, number> {
  const parsed = parseRecord(value)
  const result: Record<string, number> = {}
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === 'number' && Number.isFinite(item)) result[key] = item
  }
  return result
}

function mapCapability(row: CapabilityRow, at = now()): CapabilityRecord {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    capabilityId: row.capability_id,
    kind: row.kind as CapabilityRecord['kind'],
    path: row.path,
    version: row.version,
    versionSource: row.version_source,
    status: row.status,
    confidence: row.confidence,
    details: parseRecord(row.details),
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    stale: row.expires_at !== null && row.expires_at <= at,
  }
}

function mapScan(row: ScanRow): CapabilityScanRecord {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    status: row.status,
    scannerVersion: row.scanner_version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts: parseCounts(row.counts),
    error: row.error,
  }
}

export class CapabilityStore {
  constructor(private readonly db: FactoryDatabase) {}

  startScan(input: { scope: CapabilityScope; projectId: string | null; scannerVersion: string }): CapabilityScanRecord {
    const id = `scn_${randomUUID()}`
    const ts = now()
    this.db.run(
      `INSERT INTO capability_scans (id, scope, project_id, status, scanner_version, started_at)
       VALUES (?, ?, ?, 'RUNNING', ?, ?)`,
      [id, input.scope, input.projectId, input.scannerVersion, ts],
    )
    return this.requireScan(id)
  }

  finishScan(id: string, status: 'COMPLETE' | 'FAILED', counts: Record<string, number>, error: string | null): CapabilityScanRecord {
    this.db.run(
      'UPDATE capability_scans SET status = ?, finished_at = ?, counts = ?, error = ? WHERE id = ?',
      [status, now(), JSON.stringify(counts), error, id],
    )
    return this.requireScan(id)
  }

  requireScan(id: string): CapabilityScanRecord {
    const row = this.db.get<ScanRow>(
      'SELECT id, scope, project_id, status, scanner_version, started_at, finished_at, counts, error FROM capability_scans WHERE id = ?',
      [id],
    )
    if (!row) throw new Error(`capability scan not found: ${id}`)
    return mapScan(row)
  }

  latestScan(scope: CapabilityScope, projectId: string | null): CapabilityScanRecord | null {
    const row = this.db.get<ScanRow>(
      `SELECT id, scope, project_id, status, scanner_version, started_at, finished_at, counts, error
       FROM capability_scans WHERE scope = ? AND ifnull(project_id, '') = ifnull(?, '')
       ORDER BY started_at DESC LIMIT 1`,
      [scope, projectId],
    )
    return row ? mapScan(row) : null
  }

  replaceRecords(
    scope: CapabilityScope,
    projectId: string | null,
    records: readonly Omit<CapabilityRecord, 'id' | 'stale'>[],
  ): CapabilityRecord[] {
    const ts = now()
    this.db.transaction(() => {
      this.db.run(
        "DELETE FROM capabilities WHERE scope = ? AND ifnull(project_id, '') = ifnull(?, '')",
        [scope, projectId],
      )
      for (const record of records) {
        this.db.run(
          `INSERT INTO capabilities
            (id, scope, project_id, capability_id, kind, path, version, version_source, status,
             confidence, details, last_seen_at, expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `cap_${randomUUID()}`,
            scope,
            projectId,
            record.capabilityId,
            record.kind,
            record.path,
            record.version,
            record.versionSource,
            record.status,
            record.confidence,
            JSON.stringify(record.details),
            record.lastSeenAt,
            record.expiresAt,
            record.updatedAt === 0 ? ts : record.updatedAt,
          ],
        )
      }
    })
    return this.list({ scope, projectId })
  }

  list(filter: { scope?: CapabilityScope; projectId?: string | null; kind?: string; status?: string } = {}): CapabilityRecord[] {
    const clauses: string[] = []
    const params: Array<string | null> = []
    if (filter.scope !== undefined) {
      clauses.push('scope = ?')
      params.push(filter.scope)
    }
    if (filter.projectId !== undefined) {
      clauses.push("ifnull(project_id, '') = ifnull(?, '')")
      params.push(filter.projectId)
    }
    if (filter.kind !== undefined) {
      clauses.push('kind = ?')
      params.push(filter.kind)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
    return this.db
      .all<CapabilityRow>(
        `SELECT id, scope, project_id, capability_id, kind, path, version, version_source, status,
                confidence, details, last_seen_at, expires_at, updated_at
         FROM capabilities${where} ORDER BY capability_id ASC`,
        params,
      )
      .map((row) => mapCapability(row))
  }

  get(capabilityId: string, scope: CapabilityScope, projectId: string | null): CapabilityRecord | undefined {
    const row = this.db.get<CapabilityRow>(
      `SELECT id, scope, project_id, capability_id, kind, path, version, version_source, status,
              confidence, details, last_seen_at, expires_at, updated_at
       FROM capabilities WHERE capability_id = ? AND scope = ? AND ifnull(project_id, '') = ifnull(?, '')`,
      [capabilityId, scope, projectId],
    )
    return row ? mapCapability(row) : undefined
  }
}
