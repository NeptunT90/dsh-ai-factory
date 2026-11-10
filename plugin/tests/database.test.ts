import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FactoryDatabase } from '../src/storage/database.js'
import { MIGRATIONS } from '../src/storage/migrations.js'
import { DatabaseSync } from 'node:sqlite'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDb(): FactoryDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'ai-factory-db-'))
  dirs.push(dir)
  return new FactoryDatabase(join(dir, 'test.db'))
}

describe('FactoryDatabase', () => {
  it('runs migrations idempotently', () => {
    const db = tempDb()
    expect(db.schemaVersion).toBe(MIGRATIONS.at(-1)?.version)
    db.close()
    const reopened = new FactoryDatabase(db.path)
    expect(reopened.schemaVersion).toBe(MIGRATIONS.at(-1)?.version)
    reopened.close()
  })

  it('rolls back a failed transaction', () => {
    const db = tempDb()
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO settings (key, value, updated_at) VALUES ('x', '1', 1)")
        throw new Error('boom')
      }),
    ).toThrowError('boom')
    expect(db.get('SELECT * FROM settings WHERE key = ?', ['x'])).toBeUndefined()
    db.close()
  })

  it('upgrades an existing v1 database without losing data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-factory-migrate-'))
    dirs.push(dir)
    const path = join(dir, 'v1.db')
    const raw = new DatabaseSync(path)
    raw.exec(MIGRATIONS[0]!.sql)
    raw.exec('PRAGMA user_version = 1')
    raw
      .prepare('INSERT INTO projects (id, name, root_path, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('prj_v1', 'old', 'C:/old', '{}', 1, 1)
    raw.close()

    const upgraded = new FactoryDatabase(path)
    expect(upgraded.schemaVersion).toBe(2)
    expect(upgraded.get<{ name: string }>('SELECT name FROM projects WHERE id = ?', ['prj_v1'])?.name).toBe('old')
    expect(upgraded.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")).toBeDefined()
    expect(upgraded.get("SELECT count(*) AS n FROM agent_profiles")?.n).toBe(0)
    upgraded.close()
  })

  it('exposes FTS5 and memory triggers', () => {
    const db = tempDb()
    expect(
      db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'"),
    ).toBeDefined()
    db.run(
      `INSERT INTO memory_entries
       (id, project_id, scope, kind, title, content, tags, tags_text, trust, confidence, source_type,
        content_hash, status, version, metadata, access_count, created_at, updated_at, accessed_at)
       VALUES ('mem_test', NULL, 'global', 'semantic', 'SQLite', 'полнотекстовый поиск', '[]', '',
        'unverified', 0.7, 'agent', 'hash', 'active', 1, '{}', 0, 1, 1, 1)`,
    )
    const hit = db.get<{ n: number }>("SELECT count(*) AS n FROM memory_fts WHERE memory_fts MATCH 'полнотекстовый*'")
    expect(hit?.n).toBe(1)
    db.close()
  })
})
