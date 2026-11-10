import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import test from 'node:test'
import { PgStore } from '../dist/pg-store.js'

const db = await PGlite.create({ extensions: { vector } })
const socket = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' })
await socket.start()
const connection = socket.getServerConn()
const port = Number(connection.slice(connection.lastIndexOf(':') + 1))
const store = await PgStore.open(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`)

test.after(async () => {
  await store.close()
  await socket.stop()
  await db.close()
})

const payload = {
  id: 'mem_pg_1',
  projectId: null,
  projectName: null,
  projectRoot: null,
  scope: 'global',
  kind: 'semantic',
  title: 'PgStore test',
  content: 'standalone pg adapter',
  tags: ['pg'],
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

test('pg adapter works over the PostgreSQL wire protocol', async () => {
  const pushed = await store.push('dev_pg', [
    { opId: 'op_pg_1', entityId: payload.id, operation: 'upsert', baseVersion: null, payload },
  ])
  assert.deepEqual(pushed.accepted, ['op_pg_1'])
  const replay = await store.push('dev_pg', [
    { opId: 'op_pg_1', entityId: payload.id, operation: 'upsert', baseVersion: null, payload },
  ])
  assert.deepEqual(replay.accepted, ['op_pg_1'])
  const pulled = await store.pull('0')
  assert.equal(pulled.changes.length, 1)
  assert.equal(pulled.changes[0].payload.content, 'standalone pg adapter')
  const health = await store.health()
  assert.equal(health.vector, true)
  assert.equal(health.memories, 1)
  assert.equal(health.operations, 1)
})
