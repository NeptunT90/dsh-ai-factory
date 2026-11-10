import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const plugin = JSON.parse(readFileSync(join(root, 'plugin/package.json'), 'utf8'))
const server = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8'))
const product = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const sumsPath = join(root, 'dist/SHA256SUMS')
const sums = existsSync(sumsPath) ? readFileSync(sumsPath, 'utf8').trim() : ''
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const firstSection = changelog.split(/\n## \[/)[1] ?? ''
const changes = ('## [' + firstSection).split('\n').slice(0, 18).join('\n').trim()

const lines = [
  `# DSH AI Factory ${product.version}`,
  '',
  `Installable plugin: **${plugin.name}@${plugin.version}**.`,
  `Sync server: **${server.name}@${server.version}**.`,
  '',
  '## Artifacts',
  '',
  '```text',
  sums,
  '```',
  '',
  '## Install',
  '',
  '```powershell',
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop -Tarball .\\dist\\dsh-ai-factory-${plugin.version}.tgz`,
  '```',
  '',
  'Server: extract the server tarball, run `npm install --omit=dev`, configure',
  '`SYNC_TOKEN` and either PGlite (`SYNC_DB_DIR`) or `DATABASE_URL`, then',
  '`node dist/index.js`.',
  '',
  '## Changes',
  '',
  changes,
  '',
  '## Verification',
  '',
  '- plugin: 67 Vitest tests, 36 tools, schema v4;',
  '- server: 10 node:test tests (PGlite, PostgreSQL wire, TLS, multi-writer);',
  '- live desktop: `factory_status`, scoped children, Model fallback, auto workflow,',
  '  dashboard, sync;',
  '- clean-room server install: npm install, health, push/pull.',
  '',
  '## Known limitations',
  '',
  '- Ubuntu/Docker deploy was not executed in this environment (no Docker/psql).',
  '- GitHub Release was not published (no remote/token/gh).',
  '- A second physical PC was not available.',
  '- PostgreSQL backup uses pg_dump (server endpoint is PGlite-only).',
  '',
]
const out = join(root, 'dist', `RELEASE_NOTES-v${product.version}.md`)
writeFileSync(out, lines.join('\n'), 'utf8')
const sha = createHash('sha256').update(readFileSync(out)).digest('hex')
console.log(JSON.stringify({ out, sha256: sha, bytes: readFileSync(out).byteLength }))
