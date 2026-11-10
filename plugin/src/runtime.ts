import { chmodSync, mkdirSync } from 'node:fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { FactoryConfig, ResolvedConfig } from './config.js'
import { resolveConfig } from './config.js'
import { AuditLog } from './core/audit.js'
import { FactoryError, errorMessage } from './core/errors.js'
import { workspaceRootOf } from './core/workspace.js'
import { ProjectService, type ProjectRecord } from './projects/service.js'
import { FactoryDatabase } from './storage/database.js'
import { MemoryEngine } from './memory/engine.js'
import type { MemoryStats } from './memory/types.js'
import { AgentRegistry } from './agents/registry.js'
import { TaskEngine } from './tasks/engine.js'
import { PlannerService } from './planner/service.js'
import { SyncService } from './sync/service.js'
import { ModelRouter } from './models/router.js'
import { AutoWorkflowService } from './workflow/auto.js'

export const FACTORY_VERSION = '0.15.0'

/** Minimal logger surface shared by Cordis and diagnostics. */
export interface PluginLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface FactoryStatus {
  readonly status: 'ready' | 'error'
  readonly version: string
  readonly driver: string
  readonly dbPath: string
  readonly dataDir: string
  readonly schemaVersion: number
  readonly startedAt: number
  readonly uptimeMs: number
  readonly projects: number
  readonly agents: number
  readonly tasks: number
  readonly recoveredTasks: number
  readonly memory: MemoryStats
  readonly error: string
}

/** Initialized AI Factory services for one plugin instance. */
export class FactoryRuntime {
  readonly config: ResolvedConfig
  readonly db: FactoryDatabase
  readonly projects: ProjectService
  readonly audit: AuditLog
  readonly memory: MemoryEngine
  readonly agents: AgentRegistry
  readonly tasks: TaskEngine
  readonly planner: PlannerService
  readonly sync: SyncService
  readonly models: ModelRouter
  autoWorkflow?: AutoWorkflowService
  private readonly childToolAllowlist = new Map<string, ReadonlySet<string>>()
  readonly startedAt = Date.now()
  private expiredOnStart = 0
  private recoveredOnStart = 0

  private constructor(config: ResolvedConfig, db: FactoryDatabase, logger: PluginLogger) {
    this.config = config
    this.db = db
    this.projects = new ProjectService(db, config.projectIdOverride)
    this.audit = new AuditLog(db, config.redactLogs)
    this.memory = new MemoryEngine(db, this.projects, config)
    this.agents = new AgentRegistry(db)
    this.agents.seedBuiltins()
    this.tasks = new TaskEngine(db, this.projects, this.agents, config)
    this.planner = new PlannerService(this.tasks, this.agents)
    this.sync = new SyncService(db, this.memory, this.audit, config)
    this.models = new ModelRouter(config)
    if (config.syncAuto) this.sync.startAuto()
    try {
      this.expiredOnStart = this.memory.expire()
    } catch (error) {
      logger.warn(`[ai-factory] expired-memory sweep failed: ${errorMessage(error)}`)
    }
    try {
      this.recoveredOnStart = this.tasks.recoverStale()
    } catch (error) {
      logger.warn(`[ai-factory] stale-task recovery failed: ${errorMessage(error)}`)
    }
    this.audit.record({
      event: 'factory.started',
      level: 'info',
      data: {
        version: FACTORY_VERSION,
        driver: db.driver,
        schemaVersion: db.schemaVersion,
        agents: this.agents.count(),
        tasks: this.tasks.count(),
        recoveredTasks: this.recoveredOnStart,
      },
    })
    if (this.recoveredOnStart > 0) {
      this.audit.record({
        event: 'factory.tasks_recovered',
        level: 'warn',
        data: { count: this.recoveredOnStart },
      })
    }
  }

  static create(config: FactoryConfig, logger: PluginLogger): FactoryRuntime {
    const resolved = resolveConfig(config)
    mkdirSync(resolved.resolvedDataDir, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') {
      try {
        chmodSync(resolved.resolvedDataDir, 0o700)
      } catch {
        // a pre-existing directory owned by another user is reported by SQLite
      }
    }
    const db = new FactoryDatabase(resolved.resolvedDbPath)
    return new FactoryRuntime(resolved, db, logger)
  }

  /** Resolve the project for a tool call and create it on first contact. */
  projectFor(exec: Pick<ToolRunContext, 'agent'> | undefined): ProjectRecord {
    return this.projects.ensure(workspaceRootOf(exec))
  }

  /** Expired entries swept during startup; diagnostics only. */
  get expiredAtStartup(): number {
    return this.expiredOnStart
  }

  status(): FactoryStatus {
    return {
      status: 'ready',
      version: FACTORY_VERSION,
      driver: this.db.driver,
      dbPath: this.db.path,
      dataDir: this.config.resolvedDataDir,
      schemaVersion: this.db.schemaVersion,
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      projects: this.projects.count(),
      agents: this.agents.count(),
      tasks: this.tasks.count(),
      recoveredTasks: this.recoveredOnStart,
      memory: this.memory.stats(),
      error: '',
    }
  }

  /** Stale RUNNING tasks recovered by the startup sweep. */
  get recoveredAtStartup(): number {
    return this.recoveredOnStart
  }

  /** Record a tool-level audit event without leaking content. */
  auditTool(event: string, project: ProjectRecord | null, exec: Pick<ToolRunContext, 'agent'>, data: Record<string, unknown> = {}): void {
    this.audit.record({
      event,
      level: 'info',
      actor: exec.agent?.id ?? 'agent',
      projectId: project?.id ?? null,
      sessionId: exec.agent?.id ?? null,
      data,
    })
  }

  /** Register the exact allowlist for one child agent session. */
  allowToolsForChild(agentId: string, tools: readonly string[]): void {
    this.childToolAllowlist.set(agentId, new Set(tools))
  }

  releaseChildTools(agentId: string): void {
    this.childToolAllowlist.delete(agentId)
  }

  /** True when the agent has an enforced child allowlist (root agents do not). */
  hasChildAllowlist(agentId: string): boolean {
    return this.childToolAllowlist.has(agentId)
  }

  isToolAllowed(agentId: string, toolName: string): boolean {
    const allowlist = this.childToolAllowlist.get(agentId)
    return allowlist === undefined ? true : allowlist.has(toolName)
  }

  /** Guard reason for a child call outside its profile allowlist. */
  toolDenial(agentId: string, toolName: string): string | undefined {
    if (!this.hasChildAllowlist(agentId)) return undefined
    if (this.isToolAllowed(agentId, toolName)) return undefined
    return `TOOL_NOT_ALLOWED: ${toolName} не входит в allowlist профиля ребёнка`
  }

  close(): void {
    this.sync.stopAuto()
    void this.autoWorkflow?.stop()
    try {
      this.audit.record({ event: 'factory.stopped', level: 'info', data: {} })
    } catch {
      // best effort
    }
    this.db.close()
  }
}

/** Error used when a tool is called while startup failed. */
export function runtimeUnavailable(message: string): FactoryError {
  return new FactoryError('STORAGE_UNAVAILABLE', message)
}
