import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [dbPathArg, manifestPathArg, pluginPackageArg] = process.argv.slice(2)
if (!dbPathArg || !manifestPathArg) {
  console.error('usage: node backup-manifest.mjs <factory.db> <manifest.json> [plugin/package.json]')
  process.exit(2)
}
const dbPath = resolve(dbPathArg)
const manifestPath = resolve(manifestPathArg)
const root = resolve(manifestPath, '..')
const pluginPackage = pluginPackageArg ? resolve(pluginPackageArg) : resolve('plugin/package.json')
if (!existsSync(dbPath)) {
  console.error(`database not found: ${dbPath}`)
  process.exit(1)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function canonicalRow(row) {
  const sorted = {}
  for (const key of Object.keys(row).sort()) sorted[key] = row[key]
  return JSON.stringify(sorted)
}

function walkFiles(dir) {
  const result = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkFiles(full))
    } else if (entry.isFile() && entry.name !== 'manifest.json' && !entry.name.endsWith('.tar.gz') && !entry.name.endsWith('.tgz')) {
      result.push(full)
    }
  }
  return result.sort()
}

const db = new DatabaseSync(dbPath, { readOnly: true })
try {
  const schemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
  const tables = names.map((name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe table: ${name}`)
    const rows = db.prepare(`SELECT * FROM "${name}"`).all()
    return { name, rows: rows.length, sha256: sha256(rows.map(canonicalRow).join('\n')) }
  })
  const files = walkFiles(root).map((path) => {
    const bytes = readFileSync(path)
    return { path: relative(root, path).replace(/\\/g, '/'), bytes: bytes.byteLength, sha256: sha256(bytes) }
  })
  const databaseBytes = readFileSync(dbPath)
  const pluginVersion = existsSync(pluginPackage) ? JSON.parse(readFileSync(pluginPackage, 'utf8')).version : '0.0.0'
  const manifest = {
    format: 'factory.backup/v1',
    pluginVersion,
    schemaVersion,
    createdAt: new Date().toISOString(),
    source: 'local',
    tables,
    files,
    database: { path: 'factory.db', bytes: databaseBytes.byteLength, sha256: sha256(databaseBytes) },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`manifest: ${manifestPath} (${tables.length} tables, schema ${schemaVersion}, plugin ${pluginVersion})`)
} finally {
  db.close()
}
