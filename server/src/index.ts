import { resolve } from 'node:path'
import { PGliteStore } from './store.js'
import { PgStore } from './pg-store.js'
import { SyncHttpServer } from './http.js'
import { BackupScheduler } from './backup.js'

const token = process.env.SYNC_TOKEN?.trim() ?? ''
if (token === '') {
  console.error('SYNC_TOKEN is required (set it in the environment; never commit it).')
  process.exit(2)
}
const dataDir = resolve(process.env.SYNC_DB_DIR?.trim() || 'data/pglite')
const port = Number.parseInt(process.env.SYNC_PORT ?? '8787', 10)
const host = process.env.SYNC_HOST?.trim() || '127.0.0.1'
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('SYNC_PORT must be 0..65535')
  process.exit(2)
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''
const store = databaseUrl === ''
  ? await PGliteStore.open(dataDir)
  : await PgStore.open(databaseUrl)
console.log(databaseUrl === '' ? 'store: embedded PGlite' : 'store: PostgreSQL (DATABASE_URL)')
const server = new SyncHttpServer(store, token)
const backupDir = process.env.SYNC_BACKUP_DIR?.trim() ?? ''
const backupIntervalHours = Number.parseFloat(process.env.SYNC_BACKUP_INTERVAL_HOURS ?? '24')
const backupKeep = Number.parseInt(process.env.SYNC_BACKUP_KEEP ?? '7', 10)
const dumpable = typeof (store as { dump?: unknown }).dump === 'function'
  ? (store as unknown as { dump(): Promise<Uint8Array> })
  : undefined
const backup = dumpable
  ? new BackupScheduler(dumpable, {
  dir: backupDir,
  intervalMs: (Number.isFinite(backupIntervalHours) ? backupIntervalHours : 24) * 60 * 60 * 1000,
  keep: Number.isFinite(backupKeep) ? backupKeep : 7,
}, (error) => console.error('scheduled backup failed:', error instanceof Error ? error.message : error))
  : undefined
backup?.start()
const started = await server.start(port, host)
console.log(`AI Factory sync server listening on http://${host}:${started.port}`)
console.log(`data: ${dataDir}; health: /health; token from env`)
if (backup?.enabled) console.log(`scheduled backups: ${backupDir} every ${backupIntervalHours}h, keep ${backupKeep}`)

async function shutdown(): Promise<void> {
  console.log('shutting down sync server')
  backup?.stop()
  await server.stop()
  await store.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
