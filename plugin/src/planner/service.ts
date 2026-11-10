import { FactoryError } from '../core/errors.js'
import type { AgentRegistry } from '../agents/registry.js'
import type { AgentRole } from '../agents/types.js'
import type { TaskEngine } from '../tasks/engine.js'
import type { TaskRecord } from '../tasks/types.js'
import type { CapabilityService } from '../capabilities/service.js'

export interface PlanStepInput {
  readonly key: string
  readonly title: string
  readonly description?: string
  readonly role?: AgentRole
  readonly agentId?: string
  readonly dependsOn?: readonly string[]
  readonly priority?: number
  readonly maxAttempts?: number
  readonly timeoutMs?: number
  readonly requiresCapabilities?: readonly string[]
}

export interface PlanCreateInput {
  readonly projectId: string
  readonly goal: string
  readonly steps: readonly PlanStepInput[]
  readonly title?: string
  readonly createdBy?: string
}

export interface PlanStepResult {
  readonly key: string
  readonly taskId: string
  readonly title: string
  readonly status: string
  readonly assignedAgentId: string | null
  readonly dependsOn: readonly string[]
}

export interface PlanResult {
  readonly parent: TaskRecord
  readonly tasks: readonly TaskRecord[]
  readonly steps: readonly PlanStepResult[]
}

/** Persist a model-produced decomposition as a parent task and dependency-linked children. */
export class PlannerService {
  constructor(
    private readonly tasks: TaskEngine,
    private readonly agents: AgentRegistry,
    private readonly capabilities?: CapabilityService,
  ) {}

  createPlan(input: PlanCreateInput): PlanResult {
    const goal = input.goal.trim()
    if (goal === '') throw new FactoryError('INVALID_INPUT', 'Цель плана не может быть пустой')
    if (input.steps.length === 0) throw new FactoryError('INVALID_INPUT', 'План должен содержать хотя бы один шаг')
    if (input.steps.length > 100) throw new FactoryError('INVALID_INPUT', 'План не может содержать больше 100 шагов')

    const byKey = new Map<string, PlanStepInput>()
    for (const step of input.steps) {
      const key = step.key.trim()
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) {
        throw new FactoryError('INVALID_INPUT', `Недопустимый ключ шага: ${step.key}`)
      }
      if (byKey.has(key)) throw new FactoryError('INVALID_INPUT', `Дублирующийся ключ шага: ${key}`)
      if (step.title.trim() === '') throw new FactoryError('INVALID_INPUT', `Шаг ${key} без названия`)
      for (const dependency of step.dependsOn ?? []) {
        if (dependency === key) throw new FactoryError('INVALID_INPUT', `Шаг ${key} зависит сам от себя`)
        if (!input.steps.some((candidate) => candidate.key === dependency)) {
          throw new FactoryError('INVALID_INPUT', `Шаг ${key} ссылается на неизвестную зависимость ${dependency}`)
        }
      }
      byKey.set(key, step)
    }

    const order = topologicalOrder([...byKey.values()])
    const requirements = [...new Set(order.flatMap((step) => step.requiresCapabilities ?? []).map((id) => id.trim()).filter((id) => id !== ''))]
    if (requirements.length > 0) {
      if (!this.capabilities) {
        throw new FactoryError('CAPABILITY_MISSING', 'CapabilityService недоступен для проверки плана', { requirements })
      }
      const check = this.capabilities.check(requirements.map((id) => ({ id })))
      if (!check.ready) {
        throw new FactoryError(
          'CAPABILITY_MISSING',
          `Не подтверждены capabilities: ${requirements.join(', ')}. Выполните factory_capability_scan/refresh.`,
          { operation: 'plan', items: check.items },
        )
      }
    }
    const director = this.agents.findByRole('director')
    const parent = this.tasks.create({
      projectId: input.projectId,
      title: (input.title?.trim() || `План: ${goal.slice(0, 200)}`).slice(0, 300),
      description: `План из ${input.steps.length} шагов`,
      goal,
      status: 'PLANNING',
      assignedAgentId: director?.id ?? null,
      assignedRole: 'director',
      plan: input.steps,
      metadata: { kind: 'plan', stepCount: input.steps.length },
      createdBy: input.createdBy ?? 'agent',
    })

    const idByKey = new Map<string, string>()
    const recorded: PlanStepResult[] = []
    const created: TaskRecord[] = []
    for (const step of order) {
      const key = step.key.trim()
      const dependencyIds = (step.dependsOn ?? []).map((dependency) => {
        const taskId = idByKey.get(dependency)
        if (!taskId) throw new FactoryError('INTERNAL', `Зависимость ${dependency} не была создана раньше ${key}`)
        return taskId
      })
      const agent = step.agentId
        ? this.agents.require(step.agentId)
        : step.role
          ? this.agents.findByRole(step.role)
          : undefined
      if (step.agentId && !agent) throw new FactoryError('NOT_FOUND', `Агент не найден: ${step.agentId}`)
      if (agent && !agent.enabled) throw new FactoryError('FORBIDDEN', `Агент отключён: ${agent.name}`)
      const task = this.tasks.create({
        projectId: input.projectId,
        parentId: parent.id,
        title: step.title.trim(),
        description: step.description ?? '',
        goal: `${goal}\n\nШаг: ${step.title.trim()}`,
        status: dependencyIds.length === 0 ? 'READY' : 'WAITING',
        priority: step.priority,
        dependencies: dependencyIds,
        assignedAgentId: agent?.id ?? null,
        assignedRole: step.role ?? agent?.role ?? null,
        maxAttempts: step.maxAttempts,
        timeoutMs: step.timeoutMs,
        metadata: {
          planKey: key,
          planParentId: parent.id,
          ...((step.requiresCapabilities?.length ?? 0) > 0 ? { requiresCapabilities: [...(step.requiresCapabilities ?? [])] } : {}),
        },
        createdBy: input.createdBy ?? 'agent',
      })
      idByKey.set(key, task.id)
      created.push(task)
      recorded.push({
        key,
        taskId: task.id,
        title: task.title,
        status: task.status,
        assignedAgentId: task.assignedAgentId,
        dependsOn: step.dependsOn ?? [],
      })
    }

    this.tasks.setPlan(parent.id, recorded, input.createdBy ?? 'agent')
    return { parent: this.tasks.require(parent.id), tasks: created, steps: recorded }
  }
}

/** Stable topological order; throws FactoryError on a dependency cycle. */
function topologicalOrder(steps: readonly PlanStepInput[]): PlanStepInput[] {
  const byKey = new Map(steps.map((step) => [step.key, step]))
  const indegree = new Map<string, number>(steps.map((step) => [step.key, 0]))
  const dependents = new Map<string, string[]>()
  for (const step of steps) {
    for (const dependency of step.dependsOn ?? []) {
      indegree.set(step.key, (indegree.get(step.key) ?? 0) + 1)
      const list = dependents.get(dependency) ?? []
      list.push(step.key)
      dependents.set(dependency, list)
    }
  }
  const queue = steps.filter((step) => (indegree.get(step.key) ?? 0) === 0).map((step) => step.key)
  const result: PlanStepInput[] = []
  while (queue.length > 0) {
    const key = queue.shift() as string
    const step = byKey.get(key)
    if (!step) continue
    result.push(step)
    for (const dependent of dependents.get(key) ?? []) {
      const next = (indegree.get(dependent) ?? 1) - 1
      indegree.set(dependent, next)
      if (next === 0) queue.push(dependent)
    }
  }
  if (result.length !== steps.length) {
    const cycleKeys = steps.filter((step) => !result.includes(step)).map((step) => step.key)
    throw new FactoryError('INVALID_INPUT', `Цикл зависимостей в плане: ${cycleKeys.join(', ')}`)
  }
  return result
}
