import { statSync } from 'node:fs'
import type { ResolvedConfig } from '../config.js'
import { workingMemoryTtlMs } from '../config.js'
import { FactoryError } from '../core/errors.js'
import { newId, now, sha256 } from '../core/ids.js'
import { assertNoSecrets, injectionMarkers } from '../core/security.js'
import type { FactoryDatabase } from '../storage/database.js'
import type { ProjectService } from '../projects/service.js'
import {
  MEMORY_KINDS,
  MEMORY_SCOPES,
  MEMORY_SOURCE_TYPES,
  MEMORY_TRUST_LEVELS,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScope,
  type MemorySearchHit,
  type MemorySearchInput,
  type MemorySourceType,
  type MemoryStats,
  type MemoryTrust,
  type MemoryUpdateInput,
  type MemoryVersion,
  type RememberInput,
  type RememberResult,
} from './types.js'

interface MemoryRow {
  id: string
  project_id: string | null
  scope: MemoryScope
  kind: MemoryKind
  title: string
  content: string
  tags: string
  tags_text: string
  trust: MemoryTrust
  confidence: number
  source_type: MemorySourceType
  source_ref: string | null
  agent_id: string | null
  session_id: string | null
  content_hash: string
  status: 'active' | 'superseded' | 'deleted'
  version: number
  supersedes_id: string | null
  metadata: string
  access_count: number
  created_at: number
  updated_at: number
  accessed_at: number | null
  expires_at: number | null
  deleted_at: number | null
}

interface MemorySearchRow extends MemoryRow {
  rank: number | null
  snippet: string | null
}

interface VersionRow {
  version: number
  snapshot: string
  changed_by: string
  change_reason: string | null
  created_at: number
}

const MEMORY_SELECT = `
  SELECT id, project_id, scope, kind, title, content, tags, tags_text, trust, confidence,
         source_type, source_ref, agent_id, session_id, content_hash, status, version,
         supersedes_id, metadata, access_count, created_at, updated_at, accessed_at,
         expires_at, deleted_at
  FROM memory_entries`

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseTags(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return []
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 64)
    if (tag === '') continue
    if (!result.includes(tag)) result.push(tag)
    if (result.length >= 50) break
  }
  return result
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
}

function titleFrom(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim() !== '') ?? content
  return firstLine.replace(/^#{1,6}\s*/, '').trim().slice(0, 120) || 'Без названия'
}

function clampConfidence(value: number | undefined, fallback = 0.7): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function isKind(value: string): value is MemoryKind {
  return (MEMORY_KINDS as readonly string[]).includes(value)
}

function isScope(value: string): value is MemoryScope {
  return (MEMORY_SCOPES as readonly string[]).includes(value)
}

function isSourceType(value: string): value is MemorySourceType {
  return (MEMORY_SOURCE_TYPES as readonly string[]).includes(value)
}

function isTrust(value: string): value is MemoryTrust {
  return (MEMORY_TRUST_LEVELS as readonly string[]).includes(value)
}

function ftsQuery(raw: string): string {
  const tokens = raw
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}_]{2,}/gu)
  if (!tokens) return ''
  return [...new Set(tokens)].slice(0, 12).map((token) => `${token}*`).join(' AND ')
}

function likeExcerpt(content: string, query: string): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  const index = compact.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return compact.slice(0, 240)
  const start = Math.max(0, index - 80)
  return `${start > 0 ? '…' : ''}${compact.slice(start, start + 240)}${start + 240 < compact.length ? '…' : ''}`
}

function likePattern(raw: string): string {
  return `%${raw.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
}

/** Durable memory engine over the local SQLite store. */
export class MemoryEngine {
  constructor(
    private readonly db: FactoryDatabase,
    private readonly projects: ProjectService,
    private readonly config: ResolvedConfig,
  ) {}

  remember(input: RememberInput): RememberResult {
    const content = normalizeContent(input.content)
    if (content === '') throw new FactoryError('INVALID_INPUT', 'Содержимое памяти не может быть пустым')
    if (content.length > this.config.maxContentChars) {
      throw new FactoryError('INVALID_INPUT', `Содержимое длиннее лимита ${this.config.maxContentChars} символов`, {
        length: content.length,
        limit: this.config.maxContentChars,
      })
    }

    const kind = input.kind ?? 'semantic'
    if (!isKind(kind)) throw new FactoryError('INVALID_INPUT', `Неизвестный тип памяти: ${String(kind)}`)
    const scope = input.scope ?? (kind === 'user' ? 'global' : 'project')
    if (!isScope(scope)) throw new FactoryError('INVALID_INPUT', `Неизвестная область памяти: ${String(scope)}`)
    if (scope === 'global' && !this.config.allowGlobalMemory) {
      throw new FactoryError('FORBIDDEN', 'Глобальная память отключена конфигурацией')
    }

    const projectId = scope === 'global' ? null : input.projectId?.trim() || null
    if (scope === 'project' && projectId === null) {
      throw new FactoryError('PROJECT_REQUIRED', 'Для памяти проекта нужен projectId')
    }
    if (projectId !== null) this.projects.require(projectId)

    const sourceType = input.sourceType ?? 'agent'
    if (!isSourceType(sourceType)) {
      throw new FactoryError('INVALID_INPUT', `Неизвестный источник памяти: ${String(sourceType)}`)
    }
    const trust = input.trust ?? (sourceType === 'user' ? 'user_confirmed' : 'unverified')
    if (!isTrust(trust)) throw new FactoryError('INVALID_INPUT', `Неизвестный уровень доверия: ${String(trust)}`)

    const title = (input.title?.trim() || titleFrom(content)).slice(0, 200)
    const tags = normalizeTags(input.tags)
    const tagsText = tags.join(' ')
    const metadata = input.metadata ?? {}
    const metadataText = JSON.stringify(metadata)
    if (metadataText.length > 65_536) {
      throw new FactoryError('INVALID_INPUT', 'metadata превышает 64 KiB')
    }

    const sourceRef = input.sourceRef?.trim() || null
    assertNoSecrets([title, content, tagsText, sourceRef ?? '', metadataText].join('\n'), 'memory')
    const warnings = injectionMarkers(`${title}\n${content}`)
    const enrichedMetadata = warnings.length > 0 ? { ...metadata, trustWarning: 'possible-prompt-injection', markers: warnings } : metadata

    const confidence = clampConfidence(input.confidence)
    const hash = sha256(`${kind}\u0000${scope}\u0000${projectId ?? ''}\u0000${content.toLowerCase()}`)
    const createdAt = now()
    const ttlHours =
      input.ttlHours === undefined
        ? kind === 'working'
          ? this.config.workingMemoryTtlHours || undefined
          : undefined
        : input.ttlHours
    if (ttlHours !== undefined && (!Number.isFinite(ttlHours) || ttlHours < 0 || ttlHours > 24 * 365)) {
      throw new FactoryError('INVALID_INPUT', 'ttlHours должен быть числом от 0 до 8760')
    }
    const expiresAt =
      ttlHours === undefined || ttlHours === 0 ? null : createdAt + Math.round(ttlHours * 60 * 60 * 1000)
    if (kind === 'working' && expiresAt === null && workingMemoryTtlMs(this.config) !== undefined) {
      // keep explicit "no expiry" working notes possible; TTL only applies when configured
    }

    const existing = this.db.get<{ id: string }>(
      `SELECT id FROM memory_entries
       WHERE status = 'active' AND ifnull(project_id, '') = ? AND kind = ? AND content_hash = ?`,
      [projectId ?? '', kind, hash],
    )
    if (existing) {
      this.db.run('UPDATE memory_entries SET access_count = access_count + 1, accessed_at = ? WHERE id = ?', [
        createdAt,
        existing.id,
      ])
      return { entry: this.require(existing.id), deduplicated: true }
    }

    const id = newId('mem')
    this.db.transaction(() => {
      if (input.supersedesId) {
        this.supersedeLocked(input.supersedesId, input.actor ?? 'agent', `superseded by ${id}`)
      }
      this.db.run(
        `INSERT INTO memory_entries
          (id, project_id, scope, kind, title, content, tags, tags_text, trust, confidence,
           source_type, source_ref, agent_id, session_id, content_hash, status, version,
           supersedes_id, metadata, access_count, created_at, updated_at, accessed_at,
           expires_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, 0, ?, ?, ?, ?, NULL)`,
        [
          id,
          projectId,
          scope,
          kind,
          title,
          content,
          JSON.stringify(tags),
          tagsText,
          trust,
          confidence,
          sourceType,
          sourceRef,
          input.agentId ?? null,
          input.sessionId ?? null,
          hash,
          input.supersedesId ?? null,
          JSON.stringify(enrichedMetadata),
          createdAt,
          createdAt,
          createdAt,
          expiresAt,
        ],
      )
    })

    return { entry: this.require(id), deduplicated: false }
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.db.get<MemoryRow>(`${MEMORY_SELECT} WHERE id = ?`, [id])
    return row ? this.toRecord(row) : undefined
  }

  require(id: string): MemoryRecord {
    const entry = this.get(id)
    if (!entry) throw new FactoryError('NOT_FOUND', `Запись памяти не найдена: ${id}`, { id })
    return entry
  }

  requireActive(id: string): MemoryRecord {
    const entry = this.require(id)
    if (entry.status !== 'active') {
      throw new FactoryError('NOT_FOUND', `Запись памяти неактивна (${entry.status}): ${id}`, { id, status: entry.status })
    }
    return entry
  }

  search(input: MemorySearchInput): MemorySearchHit[] {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? this.config.maxSearchResults)))
    const query = input.query?.trim() ?? ''
    const clauses: string[] = ["m.status = 'active'", '(m.expires_at IS NULL OR m.expires_at > ?)']
    const params: Array<string | number | null> = [now()]

    if (input.projectId) {
      if (input.includeGlobal === false) {
        clauses.push('m.project_id = ?')
        params.push(input.projectId)
      } else {
        clauses.push("(m.project_id = ? OR m.scope = 'global')")
        params.push(input.projectId)
      }
    }
    if (input.scope) {
      clauses.push('m.scope = ?')
      params.push(input.scope)
    }
    if (input.kinds && input.kinds.length > 0) {
      for (const kind of input.kinds) {
        if (!isKind(kind)) throw new FactoryError('INVALID_INPUT', `Неизвестный тип памяти: ${kind}`)
      }
      clauses.push(`m.kind IN (${input.kinds.map(() => '?').join(', ')})`)
      params.push(...input.kinds)
    }
    if (input.minConfidence !== undefined) {
      clauses.push('m.confidence >= ?')
      params.push(clampConfidence(input.minConfidence, 0))
    }

    const fts = ftsQuery(query)
    let rows: MemorySearchRow[]
    if (fts !== '') {
      try {
        rows = this.db.all<MemorySearchRow>(
          `SELECT m.*, bm25(memory_fts, 6.0, 1.0, 3.0) AS rank,
                  snippet(memory_fts, 1, '…', '…', '…', 16) AS snippet
           FROM memory_fts
           JOIN memory_entries m ON m.rowid = memory_fts.rowid
           WHERE memory_fts MATCH ? AND ${clauses.join(' AND ')}
           ORDER BY rank ASC, m.updated_at DESC
           LIMIT ?`,
          [fts, ...params, limit * 4],
        )
      } catch {
        rows = this.searchLike(query, clauses, params, limit * 4)
      }
    } else if (query !== '') {
      rows = this.searchLike(query, clauses, params, limit * 4)
    } else {
      rows = this.db.all<MemorySearchRow>(
        `SELECT m.*, NULL AS rank, NULL AS snippet
         FROM memory_entries m
         WHERE ${clauses.join(' AND ')}
         ORDER BY m.updated_at DESC
         LIMIT ?`,
        [...params, limit * 4],
      )
    }

    const requiredTags = normalizeTags(input.tags)
    const filtered =
      requiredTags.length === 0
        ? rows
        : rows.filter((row) => {
            const tags = parseTags(row.tags)
            return requiredTags.every((tag) => tags.includes(tag))
          })

    return filtered.slice(0, limit).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      scope: row.scope,
      kind: row.kind,
      title: row.title,
      snippet: row.snippet?.trim() || likeExcerpt(row.content, query),
      score: row.rank === null ? 0 : Math.max(0, -row.rank),
      trust: row.trust,
      confidence: row.confidence,
      tags: parseTags(row.tags),
      updatedAt: row.updated_at,
    }))
  }

  update(input: MemoryUpdateInput): MemoryRecord {
    const current = this.requireActive(input.id)
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new FactoryError('VERSION_MISMATCH', `Ожидалась версия ${input.expectedVersion}, актуальная ${current.version}`, {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      })
    }

    const content = input.content === undefined ? current.content : normalizeContent(input.content)
    if (content === '') throw new FactoryError('INVALID_INPUT', 'Содержимое памяти не может быть пустым')
    if (content.length > this.config.maxContentChars) {
      throw new FactoryError('INVALID_INPUT', `Содержимое длиннее лимита ${this.config.maxContentChars} символов`)
    }
    const title = (input.title === undefined ? current.title : input.title.trim()).slice(0, 200)
    if (title === '') throw new FactoryError('INVALID_INPUT', 'Заголовок не может быть пустым')
    const tags = input.tags === undefined ? [...current.tags] : normalizeTags(input.tags)
    const tagsText = tags.join(' ')
    const trust = input.trust ?? current.trust
    if (!isTrust(trust)) throw new FactoryError('INVALID_INPUT', `Неизвестный уровень доверия: ${String(trust)}`)
    const confidence = clampConfidence(input.confidence, current.confidence)
    const metadata = input.metadata === undefined ? current.metadata : { ...current.metadata, ...input.metadata }
    const metadataText = JSON.stringify(metadata)
    if (metadataText.length > 65_536) throw new FactoryError('INVALID_INPUT', 'metadata превышает 64 KiB')
    assertNoSecrets([title, content, tagsText, metadataText].join('\n'), 'memory')

    const hash = sha256(`${current.kind}\u0000${current.scope}\u0000${current.projectId ?? ''}\u0000${content.toLowerCase()}`)
    const duplicate = this.db.get<{ id: string }>(
      `SELECT id FROM memory_entries
       WHERE status = 'active' AND id <> ? AND ifnull(project_id, '') = ? AND kind = ? AND content_hash = ?`,
      [current.id, current.projectId ?? '', current.kind, hash],
    )
    if (duplicate) {
      throw new FactoryError('DUPLICATE_MEMORY', `Такая запись уже существует: ${duplicate.id}`, {
        duplicateId: duplicate.id,
      })
    }

    const updatedAt = now()
    let expiresAt = current.expiresAt
    if (input.ttlHours !== undefined) {
      if (!Number.isFinite(input.ttlHours) || input.ttlHours < 0 || input.ttlHours > 24 * 365) {
        throw new FactoryError('INVALID_INPUT', 'ttlHours должен быть числом от 0 до 8760')
      }
      expiresAt = input.ttlHours === 0 ? null : updatedAt + Math.round(input.ttlHours * 60 * 60 * 1000)
    }

    this.db.transaction(() => {
      this.insertVersion(this.require(input.id), input.actor ?? 'agent', input.reason ?? 'update')
      this.db.run(
        `UPDATE memory_entries
         SET title = ?, content = ?, tags = ?, tags_text = ?, trust = ?, confidence = ?,
             content_hash = ?, metadata = ?, updated_at = ?, accessed_at = ?, expires_at = ?,
             version = version + 1
         WHERE id = ?`,
        [
          title,
          content,
          JSON.stringify(tags),
          tagsText,
          trust,
          confidence,
          hash,
          JSON.stringify(metadata),
          updatedAt,
          updatedAt,
          expiresAt,
          input.id,
        ],
      )
    })
    return this.require(input.id)
  }

  forget(id: string, actor = 'agent', reason = 'forget'): MemoryRecord {
    const current = this.requireActive(id)
    const deletedAt = now()
    this.db.transaction(() => {
      this.insertVersion(current, actor, reason)
      this.db.run(
        `UPDATE memory_entries
         SET status = 'deleted', deleted_at = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
        [deletedAt, deletedAt, id],
      )
    })
    return this.require(id)
  }

  history(id: string): MemoryVersion[] {
    this.require(id)
    return this.db
      .all<VersionRow>(
        `SELECT version, snapshot, changed_by, change_reason, created_at
         FROM memory_versions WHERE entry_id = ? ORDER BY version DESC LIMIT 100`,
        [id],
      )
      .map((row) => {
        const parsed: unknown = JSON.parse(row.snapshot)
        return {
          version: row.version,
          changedBy: row.changed_by,
          changeReason: row.change_reason,
          createdAt: row.created_at,
          snapshot: parsed as MemoryRecord,
        }
      })
  }

  stats(): MemoryStats {
    const total = this.db.get<{ n: number }>('SELECT count(*) AS n FROM memory_entries')?.n ?? 0
    const active = this.db.get<{ n: number }>("SELECT count(*) AS n FROM memory_entries WHERE status = 'active'")?.n ?? 0
    const byKind = Object.fromEntries(MEMORY_KINDS.map((kind) => [kind, 0])) as Record<MemoryKind, number>
    for (const row of this.db.all<{ kind: MemoryKind; n: number }>(
      "SELECT kind, count(*) AS n FROM memory_entries WHERE status = 'active' GROUP BY kind",
    )) {
      byKind[row.kind] = row.n
    }
    const byScope: Record<MemoryScope, number> = { project: 0, global: 0 }
    for (const row of this.db.all<{ scope: MemoryScope; n: number }>(
      "SELECT scope, count(*) AS n FROM memory_entries WHERE status = 'active' GROUP BY scope",
    )) {
      byScope[row.scope] = row.n
    }
    const projects = this.db.get<{ n: number }>('SELECT count(*) AS n FROM projects')?.n ?? 0
    const versions = this.db.get<{ n: number }>('SELECT count(*) AS n FROM memory_versions')?.n ?? 0
    const auditEvents = this.db.get<{ n: number }>('SELECT count(*) AS n FROM audit_log')?.n ?? 0
    let dbBytes = 0
    if (this.db.path !== ':memory:') {
      try {
        dbBytes = statSync(this.db.path).size
      } catch {
        dbBytes = 0
      }
    }
    return { totalEntries: total, activeEntries: active, byKind, byScope, projects, versions, auditEvents, dbBytes }
  }

  /** Mark expired active entries as deleted and keep a version snapshot. */
  expire(nowTs = now()): number {
    const expired = this.db.all<MemoryRow>(
      `${MEMORY_SELECT} WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
      [nowTs],
    )
    if (expired.length === 0) return 0
    this.db.transaction(() => {
      for (const row of expired) {
        const record = this.toRecord(row)
        this.insertVersion(record, 'system', 'expired')
        this.db.run(
          `UPDATE memory_entries
           SET status = 'deleted', deleted_at = ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
          [nowTs, nowTs, record.id],
        )
      }
    })
    return expired.length
  }

  private searchLike(
    query: string,
    clauses: readonly string[],
    params: readonly (string | number | null)[],
    limit: number,
  ): MemorySearchRow[] {
    const pattern = likePattern(query)
    return this.db.all<MemorySearchRow>(
      `SELECT m.*, NULL AS rank, NULL AS snippet
       FROM memory_entries m
       WHERE ${clauses.join(' AND ')}
         AND (lower(m.title) LIKE ? ESCAPE '\\' OR lower(m.content) LIKE ? ESCAPE '\\' OR lower(m.tags_text) LIKE ? ESCAPE '\\')
       ORDER BY m.updated_at DESC
       LIMIT ?`,
      [...params, pattern, pattern, pattern, limit],
    )
  }

  private supersedeLocked(id: string, actor: string, reason: string): MemoryRecord {
    const current = this.requireActive(id)
    const ts = now()
    this.insertVersion(current, actor, reason)
    this.db.run(
      `UPDATE memory_entries
       SET status = 'superseded', updated_at = ?, version = version + 1
       WHERE id = ?`,
      [ts, id],
    )
    return this.require(id)
  }

  private insertVersion(record: MemoryRecord, actor: string, reason: string): void {
    this.db.run(
      `INSERT OR IGNORE INTO memory_versions (entry_id, version, snapshot, changed_by, change_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.id, record.version, JSON.stringify(record), actor.slice(0, 200), reason.slice(0, 300), now()],
    )
  }

  private toRecord(row: MemoryRow): MemoryRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      scope: row.scope,
      kind: row.kind,
      title: row.title,
      content: row.content,
      tags: parseTags(row.tags),
      trust: row.trust,
      confidence: row.confidence,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      agentId: row.agent_id,
      sessionId: row.session_id,
      status: row.status,
      version: row.version,
      supersedesId: row.supersedes_id,
      metadata: parseJsonObject(row.metadata),
      accessCount: row.access_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessedAt: row.accessed_at,
      expiresAt: row.expires_at,
      deletedAt: row.deleted_at,
    }
  }
}
