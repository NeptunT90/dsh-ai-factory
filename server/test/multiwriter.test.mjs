import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import test from 'node:test'
import { PgStore } from '../dist/pg-store.js'

const db = await PGlite.create({ extensions: { vector } })
const socket = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 2 })
await socket.start()
const connection = socket.getServerConn()
const port = Number(connection.slice(connection.lastIndexOf(':') + 1))
const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
const first = await PgStore.open(url)
const second = await PgStore.open(url)

test.after(async () => {
  await first.close()
  await second.close()
  await socket.stop()
  await db.close()
})

const payload = {
  id: 'mem_multi_1',
  projectId: null,
  projectName: null,
  projectRoot: null,
  scope: 'global',
  kind: 'semantic',
  title: 'Multi-writer test',
  content: 'same op from two server processes',
  tags: [],
  trust: 'verified',
  confidence: 0.9,
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

test('two PostgreSQL writers accept the same idempotency key exactly once', async () => {
  const operation = {
    opId: 'op_multi_1',
    entityId: payload.id,
    operation: 'upsert',
    baseVersion: null,
    payload,
  }
  const [left, right] = await Promise.all([
    first.push('dev_left', [operation]),
    second.push('dev_right', [operation]),
  ])
  assert.deepEqual(left.accepted, ['op_multi_1'])
  assert.deepEqual(right.accepted, ['op_multi_1'])
  const health = await first.health()
  assert.equal(health.operations, 1)
  assert.equal(health.memories, 1)
  const pulled = await second.pull('0')
  assert.equal(pulled.changes.length, 1)
})
