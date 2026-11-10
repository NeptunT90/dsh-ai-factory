import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PGliteStore } from '../dist/store.js'
import { SyncHttpServer } from '../dist/http.js'

const dir = mkdtempSync(join(tmpdir(), 'af-sync-http-'))
const store = await PGliteStore.open(dir)
const server = new SyncHttpServer(store, 'test-token')
const started = await server.start(0, '127.0.0.1')

test.after(async () => {
  await server.stop()
  await store.close()
  rmSync(dir, { recursive: true, force: true })
})

const payload = {
  id: 'mem_http_0001',
  projectId: null,
  projectName: null,
  projectRoot: null,
  scope: 'global',
  kind: 'semantic',
  title: 'HTTP sync test',
  content: 'HTTP body',
  tags: [],
  trust: 'unverified',
  confidence: 0.7,
  sourceType: 'agent',
  sourceRef: null,
  agentId: null,
  sessionId: null,
  status: 'active',
  version: 1,
  supersedesId: null,
  metadata: {},
  createdAt: 1,
  updatedAt: 1,
  accessedAt: null,
  expiresAt: null,
  deletedAt: null,
}

test('health is public, push/pull require the bearer token', async () => {
  const health = await fetch(`${started.url}/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).vector, true)

  const unauthorized = await fetch(`${started.url}/v1/sync/push`, { method: 'POST', body: '{}' })
  assert.equal(unauthorized.status, 401)

  const pushed = await fetch(`${started.url}/v1/sync/push`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocol: 1,
      deviceId: 'dev_http',
      operations: [
        { opId: 'op_http_1', entityId: payload.id, operation: 'upsert', baseVersion: null, payload },
      ],
    }),
  })
  assert.equal(pushed.status, 200)
  const pushBody = await pushed.json()
  assert.deepEqual(pushBody.accepted, ['op_http_1'])

  const pulled = await fetch(`${started.url}/v1/sync/pull?since=0&deviceId=dev_http`, {
    headers: { Authorization: 'Bearer test-token' },
  })
  assert.equal(pulled.status, 200)
  const pullBody = await pulled.json()
  assert.equal(pullBody.changes.length, 1)
  assert.equal(pullBody.changes[0].payload.content, 'HTTP body')

  const backup = await fetch(`${started.url}/v1/admin/backup`, {
    headers: { Authorization: 'Bearer test-token' },
  })
  assert.equal(backup.status, 200)
  assert.equal(backup.headers.get('content-type'), 'application/gzip')
  const bytes = new Uint8Array(await backup.arrayBuffer())
  assert.equal(bytes[0], 0x1f)
  assert.equal(bytes[1], 0x8b)
})
