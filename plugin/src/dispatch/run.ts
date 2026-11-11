import { FactoryError } from '../core/errors.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { FactoryRuntime } from '../runtime.js'
import { AGENT_ROLES, type AgentRole } from '../agents/types.js'
import type { ChildRunner } from '../agents/scoped-runner.js'
import { DispatchService, type DispatchOutput } from './service.js'

export interface RunInput {
  readonly projectId: string
  readonly title: string
  readonly description?: string
  readonly role?: AgentRole
  readonly async?: boolean
}

export interface RunAsyncOutput {
  readonly taskId: string
  readonly async: true
  readonly status: string
  readonly message: string
}

export type RunOutput = RunAsyncOutput | DispatchOutput

/** Create a task and dispatch it in one operation. */
export class RunService {
  private readonly dispatcher: DispatchService

  constructor(
    ctx: Context,
    private readonly runtime: FactoryRuntime,
    runner?: ChildRunner,
  ) {
    this.dispatcher = new DispatchService(ctx, runtime, runner)
  }

  async run(input: RunInput, exec: ToolRunContext): Promise<RunOutput> {
    const role = input.role ?? 'executor'
    if (!(AGENT_ROLES as readonly string[]).includes(role)) {
      throw new FactoryError('INVALID_INPUT', `Неизвестная роль: ${String(role)}`)
    }
    const agent = this.runtime.agents.findByRole(role)
    if (!agent) throw new FactoryError('NOT_FOUND', `Нет включённого профиля для роли ${role}`)
    const task = this.runtime.tasks.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? '',
      assignedAgentId: agent.id,
      assignedRole: role,
      createdBy: exec.agent?.id ?? undefined,
    })
    this.runtime.audit.record({
      event: 'run.created',
      level: 'info',
      actor: exec.agent?.id ? String(exec.agent.id) : undefined,
      projectId: input.projectId,
      sessionId: exec.agent?.id ? String(exec.agent.id) : null,
      data: { taskId: task.id, role, agentId: agent.id, async: input.async !== false },
    })
    if (input.async === false) {
      return this.dispatcher.dispatch({ taskId: task.id }, exec)
    }
    return this.dispatcher.dispatchAsync({ taskId: task.id }, exec)
  }
}
