import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import type { ChildRunner } from '../agents/scoped-runner.js'
import { WorkflowService, type WorkflowResult } from './service.js'

/**
 * Optional autonomous loop: a plugin-owned coordinator Agent becomes the
 * parent for workflow children. It is never prompted itself; it only supplies
 * a live parent identity so ctx.agents.create can run executor/reviewer
 * children. Disabled by default.
 */
export class AutoWorkflowService {
  private timer: ReturnType<typeof setInterval> | undefined
  private handle: Awaited<ReturnType<AgentRegistry['create']>> | undefined
  private coordinator: Agent | undefined
  private active: Promise<void> | undefined
  private activeController: AbortController | undefined
  private ticking = false
  private stopped = false

  constructor(
    private readonly ctx: Context,
    private readonly runtime: FactoryRuntime,
    private readonly runner?: ChildRunner,
    private readonly stopTimeoutMs = 5_000,
  ) {}

  get enabled(): boolean {
    return this.runtime.config.autoWorkflowEnabled
  }

  get running(): boolean {
    return this.active !== undefined || this.ticking
  }

  get timerActive(): boolean {
    return this.timer !== undefined
  }

  async start(): Promise<void> {
    if (!this.enabled || this.timer !== undefined) return
    this.stopped = false
    try {
      await this.ensureCoordinator()
    } catch (error) {
      this.runtime.audit.record({
        event: 'auto_workflow.start_failed',
        level: 'error',
        data: { error: errorMessage(error).slice(0, 500) },
      })
      return
    }
    const interval = Math.max(30_000, this.runtime.config.autoWorkflowIntervalSeconds * 1000)
    this.timer = setInterval(() => {
      void this.tickOnce().catch((error: unknown) => {
        this.runtime.audit.record({
          event: 'auto_workflow.failed',
          level: 'warn',
          data: { error: errorMessage(error).slice(0, 500) },
        })
      })
    }, interval)
    this.timer.unref?.()
    this.runtime.audit.record({ event: 'auto_workflow.started', level: 'info', data: { intervalMs: interval } })
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    const active = this.active
    if (active) {
      const timedOut = await Promise.race([
        active.then(() => false).catch(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), this.stopTimeoutMs)),
      ])
      if (timedOut) {
        this.runtime.audit.record({
          event: 'auto_workflow.stop_timeout',
          level: 'warn',
          data: { timeoutMs: this.stopTimeoutMs },
        })
        this.activeController?.abort()
        await Promise.race([
          active.catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, Math.min(1_000, this.stopTimeoutMs))),
        ])
      }
    }
    const handle = this.handle
    this.handle = undefined
    this.coordinator = undefined
    if (handle) await handle.dispose().catch(() => undefined)
  }

  /** One scan; exposed for tests and manual diagnostics. */
  async tickOnce(): Promise<WorkflowResult[]> {
    if (this.stopped) return []
    if (this.ticking) return []
    this.ticking = true
    const controller = new AbortController()
    this.activeController = controller
    const promise = this.tickOnceInner(controller.signal)
    this.active = promise.then(() => undefined).catch(() => undefined)
    try {
      return await promise
    } finally {
      this.ticking = false
      if (this.activeController === controller) this.activeController = undefined
      this.active = undefined
    }
  }

  private async tickOnceInner(signal: AbortSignal): Promise<WorkflowResult[]> {
    const tasks = this.runtime.tasks
      .listAll(200)
      .filter((task) => task.status === 'READY')
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, Math.max(1, Math.min(5, this.runtime.config.autoWorkflowMaxTasks)))
    if (tasks.length === 0) return []
    const coordinator = await this.ensureCoordinator()
    const exec = {
      callId: `auto_${randomUUID()}`,
      name: 'auto_workflow',
      arguments: {},
      signal,
      agent: coordinator,
    } as unknown as ToolRunContext
    const results: WorkflowResult[] = []
    for (const task of tasks) {
      if (signal.aborted) break
      try {
        const service = new WorkflowService(this.ctx, this.runtime, this.runner)
        const result = await service.run(
          {
            taskId: task.id,
            maxCycles: this.runtime.config.autoWorkflowMaxCycles,
          },
          exec,
          true,
        )
        results.push(result)
        this.runtime.audit.record({
          event: 'auto_workflow.tick',
          level: result.status === 'PASSED' ? 'info' : 'warn',
          data: { taskId: task.id, status: result.status, cycles: result.cycles.length },
        })
      } catch (error) {
        this.runtime.audit.record({
          event: 'auto_workflow.task_failed',
          level: 'warn',
          data: { taskId: task.id, error: errorMessage(error).slice(0, 500) },
        })
      }
    }
    return results
  }

  private async ensureCoordinator(): Promise<Agent> {
    if (this.coordinator) return this.coordinator
    const agents = this.ctx.get('agents') as AgentRegistry | undefined
    if (!agents) throw new Error('ctx.agents недоступен для autonomous workflow')
    const sessionId = `ses_${randomUUID()}` as SessionId
    this.handle = await agents.create({
      sessionId,
      meta: { cwd: this.runtime.config.resolvedDataDir, delegationDepth: 0 },
    })
    this.coordinator = this.handle.agent
    return this.coordinator
  }
}
