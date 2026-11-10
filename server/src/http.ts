import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { SyncStore } from './store-types.js'

const MAX_BODY_BYTES = 8 * 1024 * 1024

function tokenEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** HTTP API for the optional sync server. */
export class SyncHttpServer {
  private server: Server | undefined
  private port = 0

  constructor(
    private readonly store: SyncStore,
    private readonly token: string,
  ) {
    if (token.trim() === '') throw new Error('SYNC_TOKEN must be non-empty')
  }

  get url(): string {
    return this.port === 0 ? '' : `http://127.0.0.1:${this.port}`
  }

  async start(port = 8787, host = '127.0.0.1'): Promise<{ port: number; url: string }> {
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        }
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'internal error' }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })
    this.port = (server.address() as AddressInfo).port
    this.server = server
    return { port: this.port, url: this.url }
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.port = 0
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === '/health') {
      const health = await this.store.health()
      this.json(res, 200, { ...health, service: 'dsh-ai-factory-sync', protocol: 1 })
      return
    }

    const auth = req.headers.authorization ?? ''
    const supplied = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? ''
    if (!tokenEqual(this.token, supplied)) {
      this.json(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/sync/push') {
      let body: {
        protocol?: number
        deviceId?: string
        operations?: Array<{
          opId: string
          entityId: string
          operation: 'upsert' | 'delete'
          baseVersion: number | null
          payload: never
        }>
      }
      try {
        body = JSON.parse(await readBody(req)) as typeof body
      } catch {
        this.json(res, 400, { error: 'invalid JSON body' })
        return
      }
      if (body.protocol !== 1 || typeof body.deviceId !== 'string' || !Array.isArray(body.operations)) {
        this.json(res, 400, { error: 'invalid sync envelope' })
        return
      }
      if (body.operations.length > 200) {
        this.json(res, 413, { error: 'too many operations; max 200' })
        return
      }
      const outcome = await this.store.push(body.deviceId, body.operations)
      this.json(res, 200, outcome)
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/sync/pull') {
      const since = url.searchParams.get('since') ?? '0'
      const outcome = await this.store.pull(since)
      this.json(res, 200, outcome)
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/admin/backup') {
      if (!this.store.dump) {
        this.json(res, 501, { error: 'backup not supported by this store' })
        return
      }
      const bytes = await this.store.dump()
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="dsh-ai-factory-sync-${Date.now()}.tar.gz"`,
        'Content-Length': String(bytes.byteLength),
      })
      res.end(Buffer.from(bytes))
      return
    }

    this.json(res, 404, { error: 'not found' })
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
}
