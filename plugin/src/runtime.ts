import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { FactoryConfig, ResolvedConfig } from './config.js'
import { resolveConfig } from './config.js'
import { AuditLog } from './core/audit.js'
import { FactoryError, errorMessage } from './core/errors.js'
import { redactSecrets } from './core/security.js'
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
import type { ToolHealthService } from './health/service.js'
import { ProjectScopeService } from './projects/policy.js'
import { SkillService } from './skills/service.js'
import { CapabilityService } from './capabilities/service.js'
import { isHostCapability } from './agents/allowlists.js'
import type { AccessLevel } from './agents/types.js'

export const FACTORY_VERSION = '0.27.0'

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
interface ActiveChild {
  readonly childId: string
  readonly followup: (message: string) => void
}

export interface CrashRecoveryResult {
  readonly handled: boolean
  readonly taskId?: string
  readonly reason: string
}

export class FactoryRuntime {
  readonly config: ResolvedConfig
  readonly db: FactoryDatabase
  readonly projects: ProjectService
  readonly audit: AuditLog
  readonly memory: MemoryEngine
  readonly agents: AgentRegistry
  readonly tasks: TaskEngine
  readonly planner: PlannerService
  readonly scope: ProjectScopeService
  readonly skills: SkillService
  readonly capabilities: CapabilityService
  readonly sync: SyncService
  readonly models: ModelRouter
  autoWorkflow?: AutoWorkflowService
  health?: ToolHealthService
  private readonly childToolAllowlist = new Map<string, ReadonlySet<string>>()
  private readonly childAccessLevels = new Map<string, AccessLevel>()
  readonly startedAt = Date.now()
  private expiredOnStart = 0
  private recoveredOnStart = 0
  private readonly activeChildren = new Map<string, ActiveChild>()

  private constructor(config: ResolvedConfig, db: FactoryDatabase, logger: PluginLogger) {
    this.config = config
    this.db = db
    this.projects = new ProjectService(db, config.projectIdOverride)
    this.audit = new AuditLog(db, config.redactLogs)
    this.memory = new MemoryEngine(db, this.projects, config)
    this.agents = new AgentRegistry(db)
    this.agents.seedBuiltins()
    this.tasks = new TaskEngine(db, this.projects, this.agents, config)
    this.capabilities = new CapabilityService(db, config)
    this.planner = new PlannerService(this.tasks, this.agents, this.capabilities)
    this.scope = new ProjectScopeService(this.projects, config.allowGlobalMemory)
    this.skills = new SkillService(this.projects, this.agents)
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
    if (config.projectIdOverride.trim() !== '') {
      this.audit.record({
        event: 'project.override_active',
        level: 'warn',
        data: {
          projectId: config.projectIdOverride.trim(),
          note: 'projectIdOverride collapses multiple workspaces into one project; isolation between them does not apply',
        },
      })
    }
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

  /**
   * Consume a watchdog crash report on startup and create a REPAIRER task
   * through DIRECTOR. Idempotent: a handled report is ignored.
   */
  /** Register the live child of a RUNNING task for human feedback. */
  registerActiveChild(taskId: string, childId: string, followup: (message: string) => void): void {
    this.activeChildren.set(taskId, { childId, followup })
  }

  /** Remove a child mapping only when it belongs to the given child id. */
  releaseActiveChild(taskId: string, childId: string): void {
    const current = this.activeChildren.get(taskId)
    if (current?.childId === childId) this.activeChildren.delete(taskId)
  }

  /** Send a human correction to the active child, if one is still registered. */
  followupActiveTask(taskId: string, message: string): { childId: string } | undefined {
    const current = this.activeChildren.get(taskId)
    if (!current) return undefined
    current.followup(message)
    return { childId: current.childId }
  }

  recoverCrashReport(path = this.crashReportPath()): CrashRecoveryResult {
    if (!existsSync(path)) return { handled: false, reason: 'no_report' }
    let report: Record<string, unknown>
    try {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        this.audit.record({ event: 'crash.report_invalid', level: 'warn', data: { reason: 'not_object' } })
        return { handled: false, reason: 'invalid_report' }
      }
      report = raw as Record<string, unknown>
    } catch (error) {
      this.audit.record({ event: 'crash.report_invalid', level: 'warn', data: { reason: errorMessage(error) } })
      return { handled: false, reason: 'invalid_report' }
    }
    if (report.handled === true) return { handled: false, reason: 'already_handled' }
    const repairer = this.agents.list({ limit: 200 }).find((agent) => agent.name === 'REPAIRER' && agent.enabled)
    const director = this.agents.list({ role: 'director', enabledOnly: true, limit: 1 })[0]
    if (!repairer || !director) {
      this.audit.record({ event: 'crash.recovery_unavailable', level: 'error', data: { repairer: Boolean(repairer), director: Boolean(director) } })
      return { handled: false, reason: 'profile_missing' }
    }
    const root = typeof report.projectRoot === 'string' && report.projectRoot.trim() !== ''
      ? report.projectRoot.trim()
      : this.projects.list(1)[0]?.rootPath ?? process.cwd()
    const project = this.projects.ensure(root)
    const reason = String(report.reason ?? 'DSH process exited').slice(0, 500)
    const exitCode = Number.isFinite(Number(report.exitCode)) ? Number(report.exitCode) : -1
    const detectedAt = String(report.detectedAt ?? new Date().toISOString()).slice(0, 100)
    const restartCount = Number.isFinite(Number(report.restartCount)) ? Number(report.restartCount) : 0
    const logTail = redactSecrets(String(report.logTail ?? '')).slice(0, 20_000)
    const description = [
      'Автоматическое восстановление после аварийного завершения DSH.',
      '',
      `Причина: ${reason}`,
      `Exit code: ${exitCode}`,
      `Обнаружено: ${detectedAt}`,
      `Перезапусков до отчёта: ${restartCount}`,
      '',
      'Проанализируй отчёт, найди причину, внеси минимальные безопасные исправления и напиши итоговый отчёт.',
      'Не удаляй пользовательские данные без явного подтверждения.',
      '',
      'Лог (хвост, секреты замаскированы):',
      '---',
      logTail || '(лог отсутствует)',
      '---',
    ].join('\n')
    let task
    try {
      task = this.tasks.create({
        projectId: project.id,
        title: `Crash recovery: ${reason}`.slice(0, 300),
        description,
        goal: 'Восстановить работоспособность после падения DSH и подтвердить результат.',
        priority: 95,
        maxAttempts: 2,
        assignedAgentId: repairer.id,
        createdBy: director.id,
        metadata: {
          crashReport: {
            format: 'factory.crash/v1',
            detectedAt,
            reason,
            exitCode,
            restartCount,
          },
        },
      })
    } catch (error) {
      this.audit.record({ event: 'crash.recovery_failed', level: 'error', data: { reason: errorMessage(error) } })
      return { handled: false, reason: 'task_failed' }
    }
    try {
      const next = {
        ...report,
        handled: true,
        handledAt: new Date().toISOString(),
        taskId: task.id,
      }
      const temp = `${path}.${process.pid}.tmp`
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      renameSync(temp, path)
    } catch (error) {
      this.audit.record({ event: 'crash.report_mark_failed', level: 'warn', data: { taskId: task.id, reason: errorMessage(error) } })
    }
    this.audit.record({
      event: 'crash.recovery_task_created',
      level: 'warn',
      data: { projectId: project.id, taskId: task.id, repairerId: repairer.id, exitCode },
    })
    return { handled: true, taskId: task.id, reason: 'created' }
  }

  private crashReportPath(): string {
    const override = process.env.DSH_AI_FACTORY_CRASH_REPORT?.trim()
    return override && override !== '' ? override : join(this.config.resolvedDataDir, 'crash-report.json')
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
      data: {
        ...data,
        actorProjectId: this.projectFor(exec).id,
        targetProjectId: project?.id ?? null,
      },
    })
  }

  /** Register the exact allowlist for one child agent session. */
  allowToolsForChild(agentId: string, tools: readonly string[], accessLevel: AccessLevel = 'workspace'): void {
    this.childToolAllowlist.set(agentId, new Set(tools))
    this.childAccessLevels.set(agentId, accessLevel)
  }

  /** Effective caller access: child profile level, trusted for the root operator. */
  agentAccessLevel(agentId: string | undefined): AccessLevel {
    if (agentId !== undefined) {
      const child = this.childAccessLevels.get(agentId)
      if (child !== undefined) return child
    }
    return 'trusted'
  }

  releaseChildTools(agentId: string): void {
    this.childToolAllowlist.delete(agentId)
    this.childAccessLevels.delete(agentId)
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
    if (isHostCapability(toolName)) {
      return `TOOL_NOT_ALLOWED: host capability ${toolName} не входит в allowlist профиля ребёнка`
    }
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
