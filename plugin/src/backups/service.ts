import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as tar from 'tar'
import type { FactoryRuntime } from '../runtime.js'
import { FactoryError } from '../core/errors.js'
import { BACKUP_FORMAT, type BackupManifest, type BackupTableDigest } from './manifest.js'

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_EXTRACTED_DB_BYTES = 512 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface BackupVerifyResult {
  readonly ok: boolean
  readonly archive: string
  readonly archiveBytes: number
  readonly pluginVersion: string
  readonly schemaVersion: number
  readonly createdAt: string
  readonly tables: readonly BackupTableDigest[]
  readonly databaseSha256: string
  readonly integrity: string
  readonly errors: readonly string[]
  readonly temporaryRemoved: boolean
}

export interface BackupRestoreTestResult {
  readonly ok: boolean
  readonly archive: string
  readonly agents: number
  readonly tasks: number
  readonly memory: number
  readonly schemaVersion: number
  readonly tables: number
  readonly errors: readonly string[]
  readonly temporaryRemoved: boolean
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeJson<T>(value: unknown, label: string): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FactoryError('INVALID_INPUT', `${label} должен быть JSON-объектом`)
  }
  return value as T
}

function parseManifest(raw: unknown): BackupManifest {
  const value = safeJson<Record<string, unknown>>(raw, 'manifest')
  if (value.format !== BACKUP_FORMAT) throw new FactoryError('INVALID_INPUT', 'manifest.format неверен')
  if (typeof value.pluginVersion !== 'string' || value.pluginVersion === '') {
    throw new FactoryError('INVALID_INPUT', 'manifest.pluginVersion отсутствует')
  }
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    throw new FactoryError('INVALID_INPUT', 'manifest.schemaVersion неверен')
  }
  if (typeof value.createdAt !== 'string' || value.createdAt === '') {
    throw new FactoryError('INVALID_INPUT', 'manifest.createdAt отсутствует')
  }
  if (!Array.isArray(value.tables)) throw new FactoryError('INVALID_INPUT', 'manifest.tables отсутствует')
  const tables = value.tables.map((item) => {
    const table = safeJson<Record<string, unknown>>(item, 'manifest.tables[]')
    if (typeof table.name !== 'string' || !SAFE_TABLE.test(table.name)) {
      throw new FactoryError('INVALID_INPUT', 'manifest.tables[].name небезопасен')
    }
    if (!Number.isSafeInteger(table.rows) || (table.rows as number) < 0) {
      throw new FactoryError('INVALID_INPUT', 'manifest.tables[].rows неверен')
    }
    if (typeof table.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(table.sha256)) {
      throw new FactoryError('INVALID_INPUT', 'manifest.tables[].sha256 неверен')
    }
    return { name: table.name, rows: table.rows as number, sha256: table.sha256 }
  })
  const database = safeJson<Record<string, unknown>>(value.database, 'manifest.database')
  if (database.path !== 'factory.db' || !Number.isSafeInteger(database.bytes) || typeof database.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(database.sha256)) {
    throw new FactoryError('INVALID_INPUT', 'manifest.database неверен')
  }
  if (value.files !== undefined && !Array.isArray(value.files)) {
    throw new FactoryError('INVALID_INPUT', 'manifest.files должен быть массивом')
  }
  return {
    format: BACKUP_FORMAT,
    pluginVersion: value.pluginVersion,
    schemaVersion: value.schemaVersion as number,
    createdAt: value.createdAt,
    source: 'local',
    tables,
    files: Array.isArray(value.files) ? (value.files as BackupManifest['files']) : [],
    database: {
      path: 'factory.db',
      bytes: database.bytes as number,
      sha256: database.sha256,
    },
  }
}

function tableDigestFromAttached(db: DatabaseSync, name: string): BackupTableDigest {
  if (!SAFE_TABLE.test(name)) throw new FactoryError('INVALID_INPUT', `unsafe table: ${name}`)
  const rows = db.prepare(`SELECT * FROM backup."${name}"`).all() as Array<Record<string, unknown>>
  const encoded = rows
    .map((row) => {
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(row).sort()) sorted[key] = row[key]
      return JSON.stringify(sorted)
    })
    .join('\n')
  return { name, rows: rows.length, sha256: sha256(encoded) }
}

export class BackupService {
  constructor(private readonly runtime: FactoryRuntime) {}

  async verify(archiveInput: string, exec: { agent?: { id: string }; session?: { header?: { cwd?: string } } }): Promise<BackupVerifyResult> {
    const archive = this.resolveArchive(archiveInput, exec)
    const archiveBytes = lstatSync(archive).size
    const errors: string[] = []
    let schemaVersion = 0
    let pluginVersion = ''
    let createdAt = ''
    let tables: BackupTableDigest[] = []
    let databaseSha256 = ''
    let integrity = ''
    const temp = mkdtempSync(join(tmpdir(), 'ai-factory-backup-verify-'))
    try {
      const magic = readFileSync(archive).subarray(0, 2)
      if (archiveBytes < 2 || magic[0] !== 0x1f || magic[1] !== 0x8b) {
        throw new FactoryError('INVALID_INPUT', 'Archive не является gzip')
      }
      const entries: Array<{ path: string; type: string; size: number }> = []
      let total = 0
      await tar.list({
        file: archive,
        strict: true,
        onentry: (entry) => {
          const path = entry.path.replace(/\\/g, '/').replace(/^\.\//, '')
          if (path.includes('\0') || path.startsWith('/') || path.split('/').includes('..')) {
            throw new FactoryError('INVALID_INPUT', `Небезопасный путь в архиве: ${path}`)
          }
          if (entry.type !== 'File' && entry.type !== 'Directory') {
            throw new FactoryError('INVALID_INPUT', `Небезопасный тип entry: ${entry.type}`)
          }
          total += entry.size ?? 0
          if (total > MAX_EXTRACTED_DB_BYTES) throw new FactoryError('INVALID_INPUT', 'Архив слишком большой после распаковки')
          entries.push({ path, type: entry.type, size: entry.size ?? 0 })
        },
      })
      if (!entries.some((entry) => entry.path === 'manifest.json') || !entries.some((entry) => entry.path === 'factory.db')) {
        throw new FactoryError('INVALID_INPUT', 'Archive должен содержать manifest.json и factory.db')
      }
      await tar.x({
        file: archive,
        cwd: temp,
        strict: true,
        preservePaths: false,
        filter: (path, entry) => {
          const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
          return ((normalized === 'manifest.json' || normalized === 'factory.db') && (entry as { type?: string }).type === 'File')
        },
      })
      const manifestPath = join(temp, 'manifest.json')
      const dbPath = join(temp, 'factory.db')
      if (lstatSync(manifestPath).size > MAX_MANIFEST_BYTES) throw new FactoryError('INVALID_INPUT', 'manifest.json превышает 1 MiB')
      if (lstatSync(dbPath).size > MAX_EXTRACTED_DB_BYTES) throw new FactoryError('INVALID_INPUT', 'factory.db превышает 512 MiB')
      const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
      pluginVersion = manifest.pluginVersion
      schemaVersion = manifest.schemaVersion
      createdAt = manifest.createdAt
      tables = [...manifest.tables]
      const actual = readFileSync(dbPath)
      databaseSha256 = sha256(actual)
      if (actual.byteLength !== manifest.database.bytes || databaseSha256 !== manifest.database.sha256) {
        errors.push('factory.db hash/size не совпадает с manifest')
      }
      const memory = new DatabaseSync(':memory:')
      try {
        memory.exec(`ATTACH DATABASE '${dbPath.replace(/'/g, "''")}' AS backup`)
        const quick = memory.prepare('PRAGMA backup.quick_check').get() as Record<string, unknown> | undefined
        integrity = String(quick ? Object.values(quick)[0] ?? JSON.stringify(quick) : 'unknown')
        if (integrity !== 'ok') errors.push(`SQLite quick_check: ${integrity}`)
        for (const table of manifest.tables) {
          const actualTable = tableDigestFromAttached(memory, table.name)
          if (actualTable.rows !== table.rows) errors.push(`${table.name}: rows ${actualTable.rows} != ${table.rows}`)
          if (actualTable.sha256 !== table.sha256) errors.push(`${table.name}: hash не совпадает`)
        }
        const userVersion = memory.prepare('PRAGMA backup.user_version').get() as Record<string, unknown> | undefined
        const actualSchema = Number(userVersion?.user_version ?? 0)
        if (actualSchema !== manifest.schemaVersion) errors.push(`schemaVersion ${actualSchema} != ${manifest.schemaVersion}`)
      } finally {
        memory.close()
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
    return {
      ok: errors.length === 0,
      archive,
      archiveBytes,
      pluginVersion,
      schemaVersion,
      createdAt,
      tables,
      databaseSha256,
      integrity,
      errors,
      temporaryRemoved: !existsSync(temp),
    }
  }

  async restoreTest(archiveInput: string, exec: { agent?: { id: string }; session?: { header?: { cwd?: string } } }): Promise<BackupRestoreTestResult> {
    const archive = this.resolveArchive(archiveInput, exec)
    const verify = await this.verify(archive, exec)
    if (!verify.ok) {
      return {
        ok: false,
        archive,
        agents: 0,
        tasks: 0,
        memory: 0,
        schemaVersion: verify.schemaVersion,
        tables: verify.tables.length,
        errors: verify.errors,
        temporaryRemoved: verify.temporaryRemoved,
      }
    }
    const temp = mkdtempSync(join(tmpdir(), 'ai-factory-backup-restore-'))
    let result: BackupRestoreTestResult = {
      ok: false,
      archive,
      agents: 0,
      tasks: 0,
      memory: 0,
      schemaVersion: verify.schemaVersion,
      tables: verify.tables.length,
      errors: [],
      temporaryRemoved: false,
    }
    try {
      await tar.x({
        file: archive,
        cwd: temp,
        strict: true,
        preservePaths: false,
        filter: (path, entry) => path.replace(/\\/g, '/').replace(/^\.\//, '') === 'factory.db' && (entry as { type?: string }).type === 'File',
      })
      const dbPath = join(temp, 'factory.db')
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const agents = Number((db.prepare('SELECT count(*) AS n FROM agent_profiles').get() as { n: number }).n)
        const tasks = Number((db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n)
        const memory = Number((db.prepare('SELECT count(*) AS n FROM memory_entries').get() as { n: number }).n)
        const schema = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
        result = {
          ok: true,
          archive,
          agents,
          tasks,
          memory,
          schemaVersion: Number(schema?.user_version ?? 0),
          tables: verify.tables.length,
          errors: [],
          temporaryRemoved: false,
        }
      } finally {
        db.close()
      }
    } catch (error) {
      result = { ...result, errors: [error instanceof Error ? error.message : String(error)] }
    } finally {
      rmSync(temp, { recursive: true, force: true })
      result = { ...result, temporaryRemoved: !existsSync(temp) }
    }
    return result
  }

  private resolveArchive(input: string, exec: { agent?: { id: string }; session?: { header?: { cwd?: string } } }): string {
    const project = this.runtime.projectFor(exec as never)
    const candidate = resolve(input)
    const roots = [join(project.rootPath, 'backups'), join(this.runtime.config.resolvedDataDir, 'backups')]
    const allowed = roots.some((root) => {
      const canonicalRoot = resolve(root)
      return candidate === canonicalRoot || candidate.startsWith(`${canonicalRoot}${process.platform === 'win32' ? '\\' : '/'}`)
    })
    if (!allowed) throw new FactoryError('INVALID_INPUT', 'Backup archive должен лежать в <project>/backups или <dataDir>/backups')
    if (!existsSync(candidate)) throw new FactoryError('NOT_FOUND', `Backup archive не найден: ${input}`)
    const stat = lstatSync(candidate)
    if (stat.isSymbolicLink()) throw new FactoryError('INVALID_INPUT', 'Symlink backup archive запрещён')
    if (!stat.isFile()) throw new FactoryError('INVALID_INPUT', 'Backup archive должен быть regular file')
    if (stat.size > MAX_ARCHIVE_BYTES) throw new FactoryError('INVALID_INPUT', 'Backup archive превышает 512 MiB')
    if (!/\.(tar\.gz|tgz)$/i.test(candidate)) throw new FactoryError('INVALID_INPUT', 'Ожидается .tar.gz или .tgz')
    return candidate
  }
}
