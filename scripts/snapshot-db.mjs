import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [source, destination, ...rest] = process.argv.slice(2)
if (!source || !destination || rest.length > 0) {
  console.error('usage: node snapshot-db.mjs <source.db> <destination.db>')
  process.exit(2)
}
const src = resolve(source)
const dst = resolve(destination)
if (!existsSync(src)) {
  console.error(`source database not found: ${src}`)
  process.exit(1)
}
mkdirSync(dirname(dst), { recursive: true })
rmSync(dst, { force: true })

const quoted = `'${dst.replace(/'/g, "''")}'`
const db = new DatabaseSync(src)
try {
  db.exec(`VACUUM INTO ${quoted}`)
} finally {
  db.close()
}
console.log(`snapshot: ${dst}`)
