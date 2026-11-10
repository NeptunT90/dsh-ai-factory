import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { FactoryError } from '../core/errors.js'
import { FACTORY_VERSION, type FactoryRuntime } from '../runtime.js'
import { DASHBOARD_HTML } from './html.js'
import type { ToolHealthSummary } from '../health/types.js'

export interface DashboardTool {
  readonly name: string
  readonly description: string
  readonly risk?: string
  readonly healthStatus?: string
  readonly healthSource?: string
  readonly healthCheckedAt?: number | null
  readonly latencyMs?: number | null
  readonly errorKind?: string | null
  readonly dependenciesChecked?: boolean
}

export interface DashboardStart {
  readonly url: string
  readonly token: string
  readonly port: number
}

interface Capability {
  readonly name: string
  readonly status: 'ready' | 'planned'
  readonly note: string
}

const CAPABILITIES: readonly Capability[] = [
  { name: 'Memory Engine', status: 'ready', note: 'SQLite, FTS5, версии, TTL' },
  { name: 'Agent Registry', status: 'ready', note: '7 профилей + пользовательские' },
  { name: 'Task Engine', status: 'ready', note: 'зависимости, lease, retry, recovery' },
  { name: 'Planner', status: 'ready', note: 'DAG-декомпозиция' },
  { name: 'Dispatch', status: 'ready', note: 'ctx.agents + scoped allowlist' },
  { name: 'Dashboard', status: 'ready', note: 'локальный read-only сервер' },
  { name: 'Model Router', status: 'ready', note: 'profile → parent → fallback' },
  { name: 'REVIEWER loop', status: 'ready', note: 'PASS/FAIL + fix task' },
  { name: 'Server sync', status: 'ready', note: 'PGlite PostgreSQL + pgvector' },
  { name: 'GitHub', status: 'planned', note: 'API/репозитории — Phase 5' },
]

function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return result
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim()
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Local, read-only dashboard server.
 *
 * Security boundaries: loopback binding only, random bearer token, HttpOnly
 * cookie after a one-time token query, no mutation methods, no external assets,
 * strict CSP and no-store caching. It exposes only sanitized factory state.
 */
export class DashboardServer {
  private server: Server | undefined
  private readonly tokenValue = randomBytes(24).toString('hex')
  private actualPort = 0
  private readonly port: number
  private readonly getToolHealth: () => readonly ToolHealthSummary[]
  private readonly projectFilter: string | null

  constructor(
    private readonly runtime: FactoryRuntime,
    private readonly getTools: () => readonly DashboardTool[],
    options: { port?: number; getToolHealth?: () => readonly ToolHealthSummary[]; projectId?: string } = {},
  ) {
    this.getToolHealth = options.getToolHealth ?? (() => [])
    this.projectFilter = options.projectId?.trim() || null
    const port = options.port ?? 0
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new FactoryError('INVALID_INPUT', 'port должен быть целым числом 0..65535')
    }
    this.port = port
  }

  get running(): boolean {
    return this.server !== undefined
  }

  get url(): string {
    return this.actualPort === 0
      ? ''
      : `http://127.0.0.1:${this.actualPort}/?token=${encodeURIComponent(this.tokenValue)}`
  }

  get token(): string {
    return this.tokenValue
  }

  async start(): Promise<DashboardStart> {
    if (this.server) {
      return { url: this.url, token: this.tokenValue, port: this.actualPort }
    }
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        }
        res.end(error instanceof Error ? `dashboard error: ${error.message}` : 'dashboard error')
      })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(this.port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
    } catch (error) {
      server.close()
      throw error
    }
    const address = server.address() as AddressInfo | null
    this.actualPort = address?.port ?? 0
    this.server = server
    return { url: this.url, token: this.tokenValue, port: this.actualPort }
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    this.actualPort = 0
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setSecurityHeaders(res)
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.actualPort || 1}`)
    const queryToken = url.searchParams.get('token') ?? undefined
    const cookieToken = parseCookies(req.headers.cookie).factory_dashboard
    const headerToken = bearer(req.headers.authorization)
    const authorized = [queryToken, headerToken, cookieToken].some(
      (candidate) => candidate !== undefined && secureEqual(candidate, this.tokenValue),
    )

    if (req.method !== 'GET') {
      this.text(res, 405, 'Только GET; dashboard read-only.')
      return
    }
    if (!authorized) {
      this.text(res, 401, 'Требуется токен dashboard.')
      return
    }

    if (url.pathname === '/') {
      if (queryToken !== undefined && secureEqual(queryToken, this.tokenValue)) {
        // Drop the token from the address bar and keep it only in an HttpOnly cookie.
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': `factory_dashboard=${this.tokenValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
          'Cache-Control': 'no-store',
        })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(DASHBOARD_HTML)
      return
    }

    if (url.pathname === '/api/state') {
      this.json(res, 200, this.state())
      return
    }
    if (url.pathname === '/api/overview') {
      this.json(res, 200, this.state().overview)
      return
    }
    if (url.pathname === '/health') {
      this.json(res, 200, { ok: true, generatedAt: Date.now() })
      return
    }
    this.text(res, 404, 'Не найдено.')
  }

  private setSecurityHeaders(res: ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    )
  }

  private text(res: ServerResponse, status: number, body: string): void {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(body)
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(jsonSafe(body))
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(text)
  }

  private state(): Record<string, unknown> {
    const runtime = this.runtime
    const allProjects = runtime.projects.list(200)
    const projects = this.projectFilter === null ? allProjects : allProjects.filter((project) => project.id === this.projectFilter)
    const projectNames = new Map(allProjects.map((project) => [project.id, project.name]))
    const tasks = runtime.tasks
      .listAll(100)
      .filter((task) => this.projectFilter === null || task.projectId === this.projectFilter)
      .map((task) => ({
      id: task.id,
      projectId: task.projectId,
      projectName: projectNames.get(task.projectId) ?? task.projectId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignedRole: task.assignedRole ?? '',
      assignedAgentId: task.assignedAgentId ?? '',
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      error: task.error ?? '',
      updatedAt: task.updatedAt,
    }))
    const memory = runtime.memory
      .search(
        this.projectFilter === null
          ? { limit: 50 }
          : { projectId: this.projectFilter, includeGlobal: false, limit: 50 },
      )
      .map((hit) => ({
      id: hit.id,
      projectId: hit.projectId,
      projectName: hit.projectId ? projectNames.get(hit.projectId) ?? hit.projectId : 'global',
      kind: hit.kind,
      title: hit.title,
      snippet: hit.snippet,
      trust: hit.trust,
      confidence: hit.confidence,
      updatedAt: hit.updatedAt,
    }))
    const agents = runtime.agents.list({ limit: 200 }).map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      enabled: agent.enabled,
      accessLevel: agent.accessLevel,
      memoryScope: agent.memoryScope,
      tools: [...agent.tools],
      allowedTools: [...agent.allowedTools],
      model: agent.model ? `${agent.modelProvider ?? 'default'}/${agent.model}` : 'inherit',
      route: (() => {
        const plan = runtime.models.plan(agent)
        return {
          primary: plan.primary ? `${plan.primary.provider}/${plan.primary.model}` : 'inherit',
          fallbacks: plan.fallbacks.map((route) => `${route.provider}/${route.model}`),
          maxAttempts: plan.maxAttempts,
        }
      })(),
      limits: agent.limits,
      version: agent.version,
    }))
    const audit = runtime.audit.recent(50).map((record) => ({
      id: record.id,
      ts: record.ts,
      level: record.level,
      event: record.event,
      actor: record.actor,
      projectId: record.projectId,
      data: record.data,
    }))
    const taskStats = this.projectFilter === null ? runtime.tasks.statsAll() : runtime.tasks.stats(this.projectFilter)
    const memoryStats = runtime.memory.stats()
    return {
      generatedAt: Date.now(),
      overview: {
        version: FACTORY_VERSION,
        driver: runtime.db.driver,
        schemaVersion: runtime.db.schemaVersion,
        uptimeMs: Date.now() - runtime.startedAt,
        dbPath: runtime.db.path,
        autonomy: runtime.config.defaultAutonomy,
        projects: projects.length,
        projectFilter: this.projectFilter,
        agents: agents.length,
        runningAgents: agents.filter((agent) => agent.enabled).length,
        tasks: taskStats,
        recoveredTasks: runtime.recoveredAtStartup,
        memory: memoryStats,
        auditEvents: runtime.audit.count(),
      },
      agents,
      tasks,
      memory,
      audit,
      tools: (() => {
        const health = new Map(this.getToolHealth().map((entry) => [entry.toolName, entry]))
        return this.getTools().slice(0, 200).map((tool) => {
          const entry = health.get(tool.name)
          return entry === undefined
            ? tool
            : {
                ...tool,
                risk: entry.risk,
                healthStatus: entry.status,
                healthSource: entry.source,
                healthCheckedAt: entry.lastCheckedAt,
                latencyMs: entry.latencyMs,
                errorKind: entry.errorKind,
                dependenciesChecked: entry.dependenciesChecked,
              }
        })
      })(),
      models: {
        enabled: runtime.config.modelRouterEnabled,
        fallbacks: runtime.config.modelFallbacks
          .split(',')
          .map((route) => route.trim())
          .filter((route) => route !== ''),
        maxAttempts: runtime.config.modelMaxAttempts,
      },
      sync: runtime.sync.status(),
      settings: {
        dataDir: runtime.config.resolvedDataDir,
        dbFile: runtime.config.dbFile,
        maxSearchResults: runtime.config.maxSearchResults,
        workingMemoryTtlHours: runtime.config.workingMemoryTtlHours,
        maxContentChars: runtime.config.maxContentChars,
        defaultAutonomy: runtime.config.defaultAutonomy,
        allowGlobalMemory: runtime.config.allowGlobalMemory,
        redactLogs: runtime.config.redactLogs,
        logLevel: runtime.config.logLevel,
        modelRouterEnabled: runtime.config.modelRouterEnabled,
        modelFallbacks: runtime.config.modelFallbacks,
        modelMaxAttempts: runtime.config.modelMaxAttempts,
        syncAuto: runtime.config.syncAuto,
        syncIntervalSeconds: runtime.config.syncIntervalSeconds,
      },
      capabilities: CAPABILITIES,
    }
  }
}
