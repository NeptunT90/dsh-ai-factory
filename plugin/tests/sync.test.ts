import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createTestRuntime, track } from './helpers.js'

const servers: Server[] = []
const previousToken = process.env.DSH_AI_FACTORY_SYNC_TOKEN

afterEach(async () => {
  process.env.DSH_AI_FACTORY_SYNC_TOKEN = previousToken
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

interface MockChange {
  seq: number
  payload: Record<string, unknown>
}

async function mockSyncServer(token = 'test-token'): Promise<{ url: string; changes: MockChange[]; seen: Set<string> }> {
  const changes: MockChange[] = []
  const seen = new Set<string>()
  let seq = 0
  const server = createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization ?? ''
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'POST' && url.pathname === '/v1/sync/push') {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          operations?: Array<{ opId: string; payload: Record<string, unknown> }>
        }
        const accepted: string[] = []
        for (const op of body.operations ?? []) {
          if (seen.has(op.opId)) {
            accepted.push(op.opId)
            continue
          }
          seen.add(op.opId)
          seq += 1
          changes.push({ seq, payload: op.payload })
          accepted.push(op.opId)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ accepted, conflicts: [], rejected: [] }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/sync/pull') {
        const since = Number(url.searchParams.get('since') ?? '0') || 0
        const selected = changes.filter((change) => change.seq > since)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ changes: selected, cursor: String(seq) }))
        return
      }
      res.writeHead(404)
      res.end()
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${address.port}`, changes, seen }
}

describe('SyncService', () => {
  it('pushes local memory and pulls it into a second local runtime', async () => {
    process.env.DSH_AI_FACTORY_SYNC_TOKEN = 'test-token'
    const mock = await mockSyncServer('test-token')
    const a = track(
      createTestRuntime({ syncUrl: mock.url, syncDeviceId: 'dev_a', syncTokenEnv: 'DSH_AI_FACTORY_SYNC_TOKEN' }),
    )
    const entry = a.runtime.memory.remember({
      content: 'Синхронизируемая запись между двумя SQLite.',
      title: 'Sync memory',
      kind: 'project',
      projectId: a.projectId,
    }).entry
    const outbox = a.runtime.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_outbox')?.n
    expect(outbox).toBe(1)

    const pushed = await a.runtime.sync.push()
    expect(pushed.accepted).toBe(1)
    expect(pushed.pending).toBe(0)
    expect(mock.changes).toHaveLength(1)

    const b = track(
      createTestRuntime({ syncUrl: mock.url, syncDeviceId: 'dev_b', syncTokenEnv: 'DSH_AI_FACTORY_SYNC_TOKEN' }),
    )
    const pulled = await b.runtime.sync.pull()
    expect(pulled.applied).toBe(1)
    const remote = b.runtime.memory.get(entry.id)
    expect(remote?.content).toContain('Синхронизируемая запись')
    expect(b.runtime.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_outbox')?.n).toBe(0)

    const updated = a.runtime.memory.update({ id: entry.id, content: 'Обновлено на компьютере A.' })
    await a.runtime.sync.push()
    const pulledUpdate = await b.runtime.sync.pull()
    expect(pulledUpdate.applied).toBe(1)
    expect(b.runtime.memory.get(entry.id)?.content).toBe('Обновлено на компьютере A.')
    expect(updated.version).toBe(2)
  })

  it('keeps failed operations in the outbox when the server is unavailable and backs off', async () => {
    process.env.DSH_AI_FACTORY_SYNC_TOKEN = 'test-token'
    const runtime = track(
      createTestRuntime({ syncUrl: 'http://127.0.0.1:1', syncDeviceId: 'dev_offline' }),
    )
    runtime.runtime.memory.remember({ content: 'offline memory', kind: 'semantic', projectId: runtime.projectId })
    await expect(runtime.runtime.sync.push()).rejects.toThrow()
    const rows = runtime.runtime.db.get<{ n: number }>(
      'SELECT count(*) AS n FROM sync_outbox WHERE sent_at IS NULL',
    )?.n
    expect(rows).toBe(1)
    expect(runtime.runtime.sync.status().failed).toBe(1)
  })

  it('does not push when the token is rejected', async () => {
    process.env.DSH_AI_FACTORY_SYNC_TOKEN = 'wrong-token'
    const mock = await mockSyncServer('right-token')
    const runtime = track(createTestRuntime({ syncUrl: mock.url, syncDeviceId: 'dev_auth' }))
    runtime.runtime.memory.remember({ content: 'auth test', kind: 'semantic', projectId: runtime.projectId })
    await expect(runtime.runtime.sync.push()).rejects.toThrow()
    expect(runtime.runtime.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_outbox WHERE sent_at IS NULL')?.n).toBe(1)
  })
})
