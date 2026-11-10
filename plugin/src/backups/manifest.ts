import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const BACKUP_FORMAT = 'factory.backup/v1'

export interface BackupTableDigest {
  readonly name: string
  readonly rows: number
  readonly sha256: string
}

export interface BackupFileDigest {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT
  readonly pluginVersion: string
  readonly schemaVersion: number
  readonly createdAt: string
  readonly source: 'local'
  readonly tables: readonly BackupTableDigest[]
  readonly files: readonly BackupFileDigest[]
  readonly database: { readonly path: string; readonly bytes: number; readonly sha256: string }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalRow(row: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(row).sort()) sorted[key] = row[key]
  return JSON.stringify(sorted)
}

export function tableDigest(db: DatabaseSync, name: string): BackupTableDigest {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe table name: ${name}`)
  const rows = db.prepare(`SELECT * FROM "${name}"`).all() as Array<Record<string, unknown>>
  return {
    name,
    rows: rows.length,
    sha256: sha256(rows.map(canonicalRow).join('\n')),
  }
}

export function listTables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>)
    .map((row) => row.name)
}

function walkFiles(root: string): string[] {
  const result: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        visit(full)
      } else if (entry.isFile() && entry.name !== 'manifest.json' && !entry.name.endsWith('.tar.gz') && !entry.name.endsWith('.tgz')) {
        result.push(full)
      }
    }
  }
  visit(root)
  return result.sort()
}

export function buildManifest(input: {
  readonly dbPath: string
  readonly root: string
  readonly pluginVersion: string
}): BackupManifest {
  const db = new DatabaseSync(input.dbPath, { readOnly: true })
  try {
    const schema = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
    const tables = listTables(db).map((name) => tableDigest(db, name))
    const files = walkFiles(input.root).map((path) => {
      const bytes = readFileSync(path)
      return {
        path: relative(input.root, path).replace(/\\/g, '/'),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      }
    })
    const databaseBytes = readFileSync(input.dbPath)
    return {
      format: BACKUP_FORMAT,
      pluginVersion: input.pluginVersion,
      schemaVersion: Number(schema?.user_version ?? 0),
      createdAt: new Date().toISOString(),
      source: 'local',
      tables,
      files,
      database: {
        path: 'factory.db',
        bytes: databaseBytes.byteLength,
        sha256: sha256(databaseBytes),
      },
    }
  } finally {
    db.close()
  }
}

export function hashFile(path: string): { bytes: number; sha256: string } {
  const stat = statSync(path)
  const bytes = readFileSync(path)
  return { bytes: stat.size, sha256: sha256(bytes) }
}
