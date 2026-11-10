import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import https from 'node:https'
import { PGliteStore } from '../dist/store.js'
import { SyncHttpServer } from '../dist/http.js'

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

test('serves HTTPS with a certificate and key, health is public', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'af-sync-tls-'))
  const key = join(root, 'key.pem')
  const cert = join(root, 'cert.pem')
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
    ], { stdio: 'ignore' })
  } catch {
    t.skip('openssl is not available')
    rmSync(root, { recursive: true, force: true })
    return
  }
  const store = await PGliteStore.open(join(root, 'data'))
  const server = new SyncHttpServer(store, 'test-token', {
    cert: readFileSync(cert),
    key: readFileSync(key),
  })
  try {
    const started = await server.start(0, '127.0.0.1')
    assert.ok(started.url.startsWith('https://'))
    const health = await getJson(`${started.url}/health`)
    assert.equal(health.status, 200)
    assert.equal(health.body.vector, true)
    assert.ok(!started.url.startsWith('http://'))
  } finally {
    await server.stop()
    await store.close()
    rmSync(root, { recursive: true, force: true })
  }
})
