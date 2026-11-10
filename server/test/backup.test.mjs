import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PGliteStore } from '../dist/store.js'

const root = mkdtempSync(join(tmpdir(), 'af-sync-restore-'))
const sourceDir = join(root, 'source')
const targetDir = join(root, 'target')
let source

test.before(async () => {
  source = await PGliteStore.open(sourceDir)
})

test.after(async () => {
  await source?.close()
  rmSync(root, { recursive: true, force: true })
})

const payload = {
  id: 'mem_restore_1',
  projectId: null,
  projectName: null,
  projectRoot: null,
  scope: 'global',
  kind: 'semantic',
  title: 'Restore test',
  content: 'survives backup/restore',
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

test('dump and restore preserve memory and pgvector schema', async () => {
  await source.push('dev_restore', [
    { opId: 'op_restore_1', entityId: payload.id, operation: 'upsert', baseVersion: null, payload },
  ])
  const bytes = await source.dump()
  assert.ok(bytes.length > 0)
  await source.close()
  source = undefined

  const restored = await PGliteStore.restore(targetDir, bytes)
  try {
    const pulled = await restored.pull('0')
    assert.equal(pulled.changes.length, 1)
    assert.equal(pulled.changes[0].payload.content, 'survives backup/restore')
    const health = await restored.health()
    assert.equal(health.vector, true)
    assert.equal(health.memories, 1)
  } finally {
    await restored.close()
  }
})
