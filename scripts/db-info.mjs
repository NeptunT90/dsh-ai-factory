import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const path = process.argv[2]
if (!path) {
  console.error('usage: node db-info.mjs <factory.db>')
  process.exit(2)
}
const file = resolve(path)
if (!existsSync(file)) {
  console.error(`not found: ${file}`)
  process.exit(2)
}
const db = new DatabaseSync(file, { readOnly: true })
try {
  const schema = db.prepare('PRAGMA user_version').get()?.user_version ?? 0
  const active = db.prepare("SELECT count(*) AS n FROM memory_entries WHERE status = 'active'").get()?.n ?? 0
  const total = db.prepare('SELECT count(*) AS n FROM memory_entries').get()?.n ?? 0
  const projects = db.prepare('SELECT count(*) AS n FROM projects').get()?.n ?? 0
  const audit = db.prepare('SELECT count(*) AS n FROM audit_log').get()?.n ?? 0
  console.log(
    JSON.stringify({
      schema,
      activeMemory: active,
      totalMemory: total,
      projects,
      auditEvents: audit,
      bytes: statSync(file).size,
    }),
  )
} finally {
  db.close()
}
