import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { FactoryError, errorMessage } from '../core/errors.js'
import { MIGRATIONS } from './migrations.js'

type DbParam = string | number | bigint | null | Uint8Array

interface StatementLike {
  run(...params: DbParam[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(...params: DbParam[]): unknown
  all(...params: DbParam[]): unknown[]
}

interface DatabaseLike {
  exec(sql: string): void
  prepare(sql: string): StatementLike
  close(): void
}

interface SqliteModule {
  DatabaseSync: new (path: string) => DatabaseLike
}

const require = createRequire(import.meta.url)

/**
 * Load node:sqlite lazily so a missing built-in produces a readable diagnostic
 * instead of preventing the whole plugin module from importing.
 */
function loadSqlite(): SqliteModule {
  try {
    return require('node:sqlite') as SqliteModule
  } catch (error) {
    throw new FactoryError(
      'SQLITE_UNAVAILABLE',
      'Встроенный модуль node:sqlite недоступен в этом процессе DSH. ' +
        `Хранилище AI Factory не запущено. Диагностика: ${errorMessage(error)}`,
    )
  }
}

/** Thin, synchronous wrapper around node:sqlite with migrations and transactions. */
export class FactoryDatabase {
  readonly driver = 'node:sqlite'
  private readonly db: DatabaseLike
  private closed = false

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    const { DatabaseSync } = loadSqlite()
    try {
      this.db = new DatabaseSync(path)
    } catch (error) {
      throw new FactoryError('STORAGE_UNAVAILABLE', `Не удалось открыть SQLite: ${errorMessage(error)}`, { path })
    }
    try {
      this.db.exec('PRAGMA foreign_keys = ON')
      this.db.exec('PRAGMA busy_timeout = 5000')
      if (path !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
      }
      this.migrate()
    } catch (error) {
      try {
        this.db.close()
      } catch {
        // ignore close failure while reporting the original error
      }
      throw error
    }
  }

  get schemaVersion(): number {
    const row = this.get<{ user_version: number }>('PRAGMA user_version')
    return row?.user_version ?? 0
  }

  /** Run a statement and return affected rows. */
  run(sql: string, params: readonly DbParam[] = []): { changes: number; lastInsertRowid: number } {
    this.assertOpen()
    const result = this.db.prepare(sql).run(...params)
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  /** Read one row, or undefined. */
  get<T>(sql: string, params: readonly DbParam[] = []): T | undefined {
    this.assertOpen()
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  /** Read all rows. */
  all<T>(sql: string, params: readonly DbParam[] = []): T[] {
    this.assertOpen()
    return this.db.prepare(sql).all(...params) as T[]
  }

  /** Run a callback inside an immediate transaction. Nested transactions are refused. */
  transaction<T>(callback: () => T): T {
    this.assertOpen()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = callback()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // the original error is more useful
      }
      throw error
    }
  }

  /** Close the connection; safe to call twice. */
  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.db.close()
    } catch {
      // teardown must not throw inside a Cordis disposer
    }
  }

  private migrate(): void {
    let current = this.schemaVersion
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue
      this.transaction(() => {
        this.db.exec(migration.sql)
        this.db.exec(`PRAGMA user_version = ${migration.version}`)
      })
      current = migration.version
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new FactoryError('STORAGE_UNAVAILABLE', 'Соединение SQLite уже закрыто')
  }
}
