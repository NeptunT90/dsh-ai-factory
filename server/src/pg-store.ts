import { Pool } from 'pg'
import type { IncomingOperation, PullOutcome, PushOutcome, ServerMemoryPayload } from './store.js'
import type { SyncStore } from './store-types.js'

interface MemoryRow {
  id: string
  project_id: string | null
  project_name: string | null
  project_root: string | null
  scope: string
  kind: string
  title: string
  content: string
  tags: unknown
  trust: string
  confidence: number
  source_type: string
  source_ref: string | null
  agent_id: string | null
  session_id: string | null
  status: string
  version: number
  supersedes_id: string | null
  metadata: unknown
  created_at: string | number
  updated_at: string | number
  accessed_at: string | number | null
  expires_at: string | number | null
  deleted_at: string | number | null
  server_seq: string | number
  last_op_id: string
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number(value)
}

function rowToPayload(row: MemoryRow): ServerMemoryPayload {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectRoot: row.project_root,
    scope: row.scope as 'project' | 'global',
    kind: row.kind,
    title: row.title,
    content: row.content,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    trust: row.trust,
    confidence: Number(row.confidence),
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    agentId: row.agent_id,
    sessionId: row.session_id,
    status: row.status,
    version: Number(row.version),
    supersedesId: row.supersedes_id,
    metadata: row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {},
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    accessedAt: num(row.accessed_at),
    expiresAt: num(row.expires_at),
    deletedAt: num(row.deleted_at),
  }
}

function validatePayload(payload: ServerMemoryPayload): string | null {
  if (!payload || typeof payload !== 'object') return 'payload is not an object'
  if (typeof payload.id !== 'string' || payload.id.length < 4) return 'payload.id invalid'
  if (payload.scope !== 'project' && payload.scope !== 'global') return 'payload.scope invalid'
  if (typeof payload.content !== 'string') return 'payload.content invalid'
  if (!Number.isFinite(payload.updatedAt) || !Number.isFinite(payload.createdAt)) return 'payload timestamps invalid'
  if (payload.scope === 'project' && !payload.projectId) return 'project scope requires projectId'
  return null
}

/**
 * Standalone PostgreSQL adapter for the sync server. Uses the same schema and
 * protocol as the embedded PGlite store; requires the pgvector extension.
 * Configure with DATABASE_URL.
 */
export class PgStore implements SyncStore {
  private constructor(private readonly pool: Pool) {}

  static async open(connectionString: string): Promise<PgStore> {
    const pool = new Pool({ connectionString, max: 5 })
    const store = new PgStore(pool)
    await store.migrate()
    return store
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE SEQUENCE IF NOT EXISTS sync_change_seq START 1;

      CREATE TABLE IF NOT EXISTS sync_memory (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        project_name TEXT,
        project_root TEXT,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        trust TEXT NOT NULL,
        confidence DOUBLE PRECISION NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        agent_id TEXT,
        session_id TEXT,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        supersedes_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        accessed_at BIGINT,
        expires_at BIGINT,
        deleted_at BIGINT,
        embedding vector(1536),
        server_seq BIGINT NOT NULL,
        last_op_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_sync_memory_seq ON sync_memory(server_seq);

      CREATE TABLE IF NOT EXISTS sync_operations (
        op_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload JSONB NOT NULL,
        applied BOOLEAN NOT NULL DEFAULT FALSE,
        server_seq BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
  }

  async push(deviceId: string, operations: IncomingOperation[]): Promise<PushOutcome> {
    const accepted: string[] = []
    const conflicts: PushOutcome['conflicts'] = []
    const rejected: Array<{ opId: string; reason: string }> = []
    for (const op of operations) {
      const invalid = validatePayload(op.payload)
      if (invalid) {
        rejected.push({ opId: op.opId, reason: invalid })
        continue
      }
      const client = await this.pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query<{ op_id: string }>(
          'SELECT op_id FROM sync_operations WHERE op_id = $1',
          [op.opId],
        )
        if (existing.rows.length > 0) {
          await client.query('COMMIT')
          accepted.push(op.opId)
          continue
        }
        const current = await client.query<{ version: number; updated_at: string | number }>(
          'SELECT version, updated_at FROM sync_memory WHERE id = $1',
          [op.payload.id],
        )
        const currentRow = current.rows[0]
        if (
          op.baseVersion !== null &&
          currentRow !== undefined &&
          Number(currentRow.version) > op.baseVersion &&
          op.payload.updatedAt <= Number(currentRow.updated_at)
        ) {
          await client.query('ROLLBACK')
          const row = await this.pool.query<MemoryRow>('SELECT * FROM sync_memory WHERE id = $1', [op.payload.id])
          const server = row.rows[0]
          conflicts.push({
            opId: op.opId,
            entityId: op.entityId,
            reason: 'version conflict',
            ...(server ? { payload: rowToPayload(server) } : {}),
          })
          continue
        }
        const tags = JSON.stringify(Array.isArray(op.payload.tags) ? op.payload.tags : [])
        const metadata = JSON.stringify(op.payload.metadata ?? {})
        const embedding = Array.isArray(op.payload.embedding) ? `[${op.payload.embedding.join(',')}]` : null
        const applied = await client.query<{ server_seq: string | number }>(
          `INSERT INTO sync_memory
            (id, project_id, project_name, project_root, scope, kind, title, content, tags, trust,
             confidence, source_type, source_ref, agent_id, session_id, status, version,
             supersedes_id, metadata, created_at, updated_at, accessed_at, expires_at, deleted_at,
             embedding, server_seq, last_op_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15,
                   $16, $17, $18, $19::jsonb, $20, $21, $22, $23, $24, $25::vector,
                   nextval('sync_change_seq'), $26)
           ON CONFLICT (id) DO UPDATE SET
             project_id = EXCLUDED.project_id, project_name = EXCLUDED.project_name,
             project_root = EXCLUDED.project_root, scope = EXCLUDED.scope, kind = EXCLUDED.kind,
             title = EXCLUDED.title, content = EXCLUDED.content, tags = EXCLUDED.tags,
             trust = EXCLUDED.trust, confidence = EXCLUDED.confidence,
             source_type = EXCLUDED.source_type, source_ref = EXCLUDED.source_ref,
             agent_id = EXCLUDED.agent_id, session_id = EXCLUDED.session_id,
             status = EXCLUDED.status, version = EXCLUDED.version,
             supersedes_id = EXCLUDED.supersedes_id, metadata = EXCLUDED.metadata,
             created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
             accessed_at = EXCLUDED.accessed_at, expires_at = EXCLUDED.expires_at,
             deleted_at = EXCLUDED.deleted_at, embedding = EXCLUDED.embedding,
             server_seq = nextval('sync_change_seq'), last_op_id = EXCLUDED.last_op_id
           WHERE EXCLUDED.updated_at > sync_memory.updated_at
           RETURNING server_seq`,
          [
            op.payload.id,
            op.payload.projectId,
            op.payload.projectName,
            op.payload.projectRoot,
            op.payload.scope,
            op.payload.kind,
            op.payload.title,
            op.payload.content,
            tags,
            op.payload.trust,
            op.payload.confidence,
            op.payload.sourceType,
            op.payload.sourceRef,
            op.payload.agentId,
            op.payload.sessionId,
            op.payload.status,
            op.payload.version,
            op.payload.supersedesId,
            metadata,
            op.payload.createdAt,
            op.payload.updatedAt,
            op.payload.accessedAt,
            op.payload.expiresAt,
            op.payload.deletedAt,
            embedding,
            op.opId,
          ],
        )
        const seq = applied.rows[0]?.server_seq ?? null
        await client.query(
          `INSERT INTO sync_operations
            (op_id, device_id, entity_id, operation, payload, applied, server_seq)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [op.opId, deviceId, op.entityId, op.operation, JSON.stringify(op.payload), seq !== null, seq],
        )
        await client.query('COMMIT')
        accepted.push(op.opId)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        rejected.push({ opId: op.opId, reason: error instanceof Error ? error.message : 'apply failed' })
      } finally {
        client.release()
      }
    }
    return { accepted, conflicts, rejected }
  }

  async pull(since: string, limit = 500): Promise<PullOutcome> {
    const sinceValue = Number.parseInt(since, 10)
    const after = Number.isFinite(sinceValue) ? sinceValue : 0
    const result = await this.pool.query<MemoryRow>(
      'SELECT * FROM sync_memory WHERE server_seq > $1 ORDER BY server_seq ASC LIMIT $2',
      [after, Math.max(1, Math.min(1000, limit))],
    )
    const changes = result.rows.map((row) => ({ opId: row.last_op_id, payload: rowToPayload(row) }))
    const cursor = result.rows.reduce((max, row) => Math.max(max, Number(row.server_seq)), after)
    return { changes, cursor: String(cursor) }
  }

  async health(): Promise<{ ok: true; vector: boolean; memories: number; operations: number }> {
    const extension = await this.pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    )
    const memories = await this.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM sync_memory')
    const operations = await this.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM sync_operations')
    return {
      ok: true,
      vector: extension.rows.length > 0,
      memories: Number(memories.rows[0]?.n ?? 0),
      operations: Number(operations.rows[0]?.n ?? 0),
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
