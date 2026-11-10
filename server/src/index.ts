import { resolve } from 'node:path'
import { PGliteStore } from './store.js'
import { SyncHttpServer } from './http.js'

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

const store = await PGliteStore.open(dataDir)
const server = new SyncHttpServer(store, token)
const started = await server.start(port, host)
console.log(`AI Factory sync server listening on http://${host}:${started.port}`)
console.log(`data: ${dataDir}; health: /health; token from env`)

async function shutdown(): Promise<void> {
  console.log('shutting down sync server')
  await server.stop()
  await store.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
