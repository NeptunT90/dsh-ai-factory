import { existsSync, realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { FactoryDatabase } from '../storage/database.js'
import { newId, now, projectIdForPath } from '../core/ids.js'
import { FactoryError } from '../core/errors.js'

/** A workspace known to AI Factory. */
export interface ProjectRecord {
  readonly id: string
  readonly name: string
  readonly rootPath: string
  readonly description: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

interface ProjectRow {
  id: string
  name: string
  root_path: string
  description: string | null
  created_at: number
  updated_at: number
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Create or look up project records; project ids stay stable across restarts. */
export class ProjectService {
  constructor(
    private readonly db: FactoryDatabase,
    private readonly projectIdOverride = '',
  ) {}

  /** Canonical path used for identity and display. */
  canonicalPath(input: string): string {
    const absolute = resolve(input)
    try {
      return realpathSync.native(absolute)
    } catch {
      return absolute
    }
  }

  /**
   * Return the project for a workspace, creating it on first contact.
   * A configured projectIdOverride pins one identity for relocated workspaces.
   */
  ensure(rootPath: string, name?: string): ProjectRecord {
    const canonical = this.canonicalPath(rootPath)
    const id = this.projectIdOverride.trim() || projectIdForPath(canonical)
    const existing = this.get(id)
    if (existing) {
      if (existing.rootPath !== canonical) {
        this.db.run('UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?', [
          canonical,
          now(),
          id,
        ])
      }
      return this.get(id) as ProjectRecord
    }
    const displayName = (name?.trim() || basename(canonical) || canonical).slice(0, 200)
    const ts = now()
    try {
      this.db.run(
        `INSERT INTO projects (id, name, root_path, description, metadata, created_at, updated_at)
         VALUES (?, ?, ?, NULL, '{}', ?, ?)`,
        [id, displayName, canonical, ts, ts],
      )
    } catch (error) {
      // A concurrent first contact may have inserted the same path.
      const raced = this.get(id)
      if (raced) return raced
      throw error
    }
    return this.get(id) as ProjectRecord
  }

  get(id: string): ProjectRecord | undefined {
    const row = this.db.get<ProjectRow>(
      'SELECT id, name, root_path, description, created_at, updated_at FROM projects WHERE id = ?',
      [id],
    )
    return row ? mapProject(row) : undefined
  }

  require(id: string): ProjectRecord {
    const project = this.get(id)
    if (!project) throw new FactoryError('NOT_FOUND', `Проект не найден: ${id}`, { projectId: id })
    return project
  }

  count(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM projects')?.n ?? 0
  }

  list(limit = 50): ProjectRecord[] {
    const capped = Math.max(1, Math.min(200, Math.floor(limit)))
    return this.db
      .all<ProjectRow>(
        `SELECT id, name, root_path, description, created_at, updated_at
         FROM projects ORDER BY updated_at DESC LIMIT ?`,
        [capped],
      )
      .map(mapProject)
  }

  /** Project id that a workspace path maps to, without creating a row. */
  idForPath(rootPath: string): string {
    return this.projectIdOverride.trim() || projectIdForPath(this.canonicalPath(rootPath))
  }

  /** Ensure a project id exists for a path; returns the id. */
  ensureId(rootPath: string): string {
    return this.ensure(rootPath).id
  }

  /** A stable new id for a project that has no path yet (reserved for future imports). */
  newProjectId(): string {
    return newId('prj')
  }

  /** Whether the path exists on disk; diagnostics only. */
  pathExists(project: ProjectRecord): boolean {
    return existsSync(project.rootPath)
  }
}
