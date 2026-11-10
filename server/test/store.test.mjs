import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PGliteStore } from '../dist/store.js'

const dir = mkdtempSync(join(tmpdir(), 'af-sync-store-'))
const store = await PGliteStore.open(dir)

test.after(async () => {
  await store.close()
  rmSync(dir, { recursive: true, force: true })
})

const payload = {
  id: 'mem_test_0001',
  projectId: 'prj_test',
  projectName: 'Test',
  projectRoot: 'C:/test',
  scope: 'project',
  kind: 'semantic',
  title: 'Server test',
  content: 'PGlite store test',
  tags: ['test'],
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

test('health reports pgvector', async () => {
  const health = await store.health()
  assert.equal(health.ok, true)
  assert.equal(health.vector, true)
})

test('push is idempotent and pull returns the stored payload', async () => {
  const op = { opId: 'op_test_1', entityId: payload.id, operation: 'upsert', baseVersion: null, payload }
  const first = await store.push('dev_test', [op])
  assert.deepEqual(first.accepted, ['op_test_1'])
  const replay = await store.push('dev_test', [op])
  assert.deepEqual(replay.accepted, ['op_test_1'])
  const pulled = await store.pull('0')
  assert.equal(pulled.changes.length, 1)
  assert.equal(pulled.changes[0].payload.content, 'PGlite store test')
  assert.equal(pulled.changes[0].payload.projectId, 'prj_test')
  assert.equal(pulled.cursor, '1')
})

test('newer updatedAt wins and older push is reported as a conflict', async () => {
  const newer = { ...payload, content: 'Newer content', version: 2, updatedAt: 2 }
  const pushNewer = await store.push('dev_test', [
    { opId: 'op_test_2', entityId: payload.id, operation: 'upsert', baseVersion: 1, payload: newer },
  ])
  assert.deepEqual(pushNewer.accepted, ['op_test_2'])
  const older = { ...payload, content: 'Older content', version: 1, updatedAt: 1 }
  const pushOlder = await store.push('dev_test', [
    { opId: 'op_test_3', entityId: payload.id, operation: 'upsert', baseVersion: 1, payload: older },
  ])
  assert.equal(pushOlder.accepted.length, 0)
  assert.equal(pushOlder.conflicts.length, 1)
  const pulled = await store.pull('0')
  assert.equal(pulled.changes.length, 1)
  assert.equal(pulled.changes[0].payload.content, 'Newer content')
})

test('rejects invalid payloads', async () => {
  const result = await store.push('dev_test', [
    {
      opId: 'op_test_bad',
      entityId: 'bad',
      operation: 'upsert',
      baseVersion: null,
      payload: { ...payload, id: 'bad' },
    },
  ])
  assert.equal(result.rejected.length, 1)
})

