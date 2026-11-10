import { PGliteStore } from '../dist/store.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = process.argv[2]?.trim() ?? process.env.SYNC_RESTORE_FILE?.trim() ?? ''
const dataDir = resolve(process.argv[3]?.trim() ?? process.env.SYNC_DB_DIR?.trim() ?? 'data/pglite')
if (file === '') {
  console.error('usage: node server/scripts/restore.mjs <backup.tar.gz> [data-dir]')
  process.exit(2)
}
const store = await PGliteStore.restore(dataDir, new Uint8Array(readFileSync(file)))
const health = await store.health()
console.log(JSON.stringify({ restored: true, dataDir, ...health }))
await store.close()
