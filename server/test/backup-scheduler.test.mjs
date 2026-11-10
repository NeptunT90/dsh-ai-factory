import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PGliteStore } from '../dist/store.js'
import { BackupScheduler } from '../dist/backup.js'

const root = mkdtempSync(join(tmpdir(), 'af-sync-backup-'))
const store = await PGliteStore.open(join(root, 'pgdata'))
const backupDir = join(root, 'backups')
const scheduler = new BackupScheduler(store, { dir: backupDir, intervalMs: 60_000, keep: 2 })

test.after(async () => {
  scheduler.stop()
  await store.close()
  rmSync(root, { recursive: true, force: true })
})

test('writes gzip archives with SHA256 and prunes to keep limit', async () => {
  const first = await scheduler.runOnce()
  assert.ok(first.bytes > 0)
  assert.match(first.sha256, /^[0-9a-f]{64}$/)
  const files = () => readdirSync(backupDir).filter((name) => name.endsWith('.tar.gz')).sort()
  assert.equal(files().length, 1)
  await scheduler.runOnce()
  await scheduler.runOnce()
  assert.equal(files().length, 2)
  const shaFiles = readdirSync(backupDir).filter((name) => name.endsWith('.sha256'))
  assert.equal(shaFiles.length, 2)
  const hashes = shaFiles.map((name) => name)
  assert.ok(hashes.every((name) => name.startsWith('dsh-ai-factory-sync-')))
})
