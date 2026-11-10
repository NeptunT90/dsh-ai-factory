import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import { asJsonValue, type JsonValue } from '../core/json.js'
import type { FactoryRuntime } from '../runtime.js'
import type { ProjectRecord } from '../projects/service.js'
import { TASK_STATUSES, type TaskEvent, type TaskRecord, type TaskStatus } from '../tasks/types.js'

const TASK_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    parentId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    description: { type: 'string', required: true },
    goal: { type: 'string', required: true },
    status: { type: 'string', required: true },
    priority: { type: 'number', required: true },
    createdBy: { type: 'string', required: true },
    assignedAgentId: { type: 'string', required: true },
    assignedRole: { type: 'string', required: true },
    plan: { type: 'json', required: true },
    dependencies: { type: 'array', items: { type: 'string' }, required: true },
    dueAt: { type: 'number', required: true },
    availableAt: { type: 'number', required: true },
    attempts: { type: 'number', required: true },
    maxAttempts: { type: 'number', required: true },
    timeoutMs: { type: 'number', required: true },
    result: { type: 'string', required: true },
    error: { type: 'string', required: true },
    metadata: { type: 'json', required: true },
    version: { type: 'number', required: true },
    leaseOwner: { type: 'string', required: true },
    leaseUntil: { type: 'number', required: true },
    createdAt: { type: 'number', required: true },
    updatedAt: { type: 'number', required: true },
    startedAt: { type: 'number', required: true },
    finishedAt: { type: 'number', required: true },
  },
} as const

interface TaskView {
  id: string
  projectId: string
  parentId: string
  title: string
  description: string
  goal: string
  status: string
  priority: number
  createdBy: string
  assignedAgentId: string
  assignedRole: string
  plan: JsonValue
  dependencies: string[]
  dueAt: number
  availableAt: number
  attempts: number
  maxAttempts: number
  timeoutMs: number
  result: string
  error: string
  metadata: JsonValue
  version: number
  leaseOwner: string
  leaseUntil: number
  createdAt: number
  updatedAt: number
  startedAt: number
  finishedAt: number
}

function view(task: TaskRecord): TaskView {
  return {
    id: task.id,
    projectId: task.projectId,
    parentId: task.parentId ?? '',
    title: task.title,
    description: task.description,
    goal: task.goal,
    status: task.status as string,
    priority: task.priority,
    createdBy: task.createdBy,
    assignedAgentId: task.assignedAgentId ?? '',
    assignedRole: task.assignedRole ?? '',
    plan: asJsonValue(task.plan),
    dependencies: [...task.dependencies],
    dueAt: task.dueAt ?? 0,
    availableAt: task.availableAt ?? 0,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    timeoutMs: task.timeoutMs ?? 0,
    result: task.result ?? '',
    error: task.error ?? '',
    metadata: asJsonValue(task.metadata),
    version: task.version,
    leaseOwner: task.leaseOwner ?? '',
    leaseUntil: task.leaseUntil ?? 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt ?? 0,
    finishedAt: task.finishedAt ?? 0,
  }
}

function formatTask(task: TaskView): string {
  return [
    `# ${task.title}`,
    `${task.status} · priority ${task.priority} · attempts ${task.attempts}/${task.maxAttempts}`,
    `id: ${task.id}`,
    task.assignedAgentId ? `agent: ${task.assignedAgentId}${task.assignedRole ? ` (${task.assignedRole})` : ''}` : 'agent: не назначен',
    task.dependencies.length > 0 ? `зависимости: ${task.dependencies.join(', ')}` : '',
    task.parentId ? `родитель: ${task.parentId}` : '',
    task.leaseOwner ? `lease: ${task.leaseOwner} до ${new Date(task.leaseUntil).toISOString()}` : '',
    task.error ? `ошибка: ${task.error}` : '',
    task.result ? `результат: ${task.result}` : '',
    '',
    task.description || task.goal,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('STORAGE_UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

function currentProject(
  runtime: FactoryRuntime,
  exec: Pick<ToolRunContext, 'agent'>,
  explicit?: string,
): ProjectRecord {
  if (explicit?.trim()) return runtime.scope.requireSame(exec, explicit.trim(), 'read')
  return runtime.projectFor(exec)
}

function assertTaskProject(
  runtime: FactoryRuntime,
  exec: ToolRunContext,
  task: TaskRecord,
  operation: 'read' | 'write' | 'delete' | 'recover',
): void {
  runtime.scope.assertTask(exec, task, operation)
}

function requireTaskFor(
  runtime: FactoryRuntime,
  exec: ToolRunContext,
  id: string,
  operation: 'read' | 'write' | 'delete' | 'recover',
): TaskRecord {
  const project = runtime.scope.current(exec)
  const task = runtime.tasks.requireForProject(id, project.id)
  runtime.scope.assertTask(exec, task, operation)
  return task
}

function leaseMsFromMinutes(minutes: number | undefined, fallback: number): number {
  if (minutes === undefined) return fallback
  if (!Number.isFinite(minutes) || minutes <= 0) throw new FactoryError('INVALID_INPUT', 'leaseMinutes должен быть > 0')
  return Math.max(10_000, Math.min(24 * 60 * 60 * 1000, Math.floor(minutes * 60_000)))
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function registerTaskTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_create',
        description:
          'Создать durable-задачу в Task Engine. Задача сохраняется в SQLite, переживает перезапуск, может иметь зависимости, агента и лимиты попыток. ' +
          'Для декомпозиции цели лучше использовать factory_plan_create.',
        parameters: {
          title: { type: 'string', required: true, description: 'Название задачи' },
          description: { type: 'string', description: 'Подробное описание' },
          goal: { type: 'string', description: 'Конечная цель задачи' },
          projectId: { type: 'string', description: 'id проекта; пусто — текущий workspace' },
          priority: { type: 'number', description: 'Приоритет 0..100 (выше — важнее)' },
          parentId: { type: 'string', description: 'Родительская задача' },
          assignedAgentId: { type: 'string', description: 'Профиль агента из Agent Registry' },
          assignedRole: { type: 'string', description: 'Роль, если агент не задан' },
          dependencies: { type: 'array', items: { type: 'string' }, description: 'id задач, которые должны завершиться' },
          dueAt: { type: 'number', description: 'Срок, epoch ms' },
          maxAttempts: { type: 'number', description: 'Максимум попыток (1..10)' },
          timeoutMs: { type: 'number', description: 'Таймаут выполнения, мс' },
          plan: { type: 'json', description: 'Структурированный план/чек-лист' },
          metadata: { type: 'json', description: 'Дополнительные JSON-метаданные' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const project = currentProject(runtime, exec, args.projectId)
          const task = runtime.tasks.create({
            projectId: project.id,
            title: args.title,
            description: args.description,
            goal: args.goal,
            priority: args.priority,
            parentId: args.parentId,
            assignedAgentId: args.assignedAgentId,
            assignedRole: args.assignedRole,
            dependencies: args.dependencies,
            dueAt: args.dueAt,
            maxAttempts: args.maxAttempts,
            timeoutMs: args.timeoutMs,
            plan: args.plan,
            metadata: asObject(args.metadata),
            createdBy: exec.agent?.id ?? 'agent',
          })
          runtime.auditTool('task.created', project, exec, { taskId: task.id, status: task.status })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_list',
        description: 'Список задач проекта с фильтрами по статусу, агенту и родителю.',
        parameters: {
          projectId: { type: 'string', description: 'id проекта; пусто — текущий' },
          statuses: { type: 'array', items: { type: 'string', enum: TASK_STATUSES }, description: 'Фильтр статусов' },
          assignedAgentId: { type: 'string', description: 'Фильтр по агенту' },
          parentId: { type: 'string', description: 'Фильтр по родительской задаче' },
          includeTerminal: { type: 'boolean', description: 'Включать COMPLETED/CANCELLED (по умолчанию false)' },
          limit: { type: 'number', description: 'Максимум задач (1..200)' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              tasks: { type: 'array', items: TASK_OUTPUT, required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                value.count === 0
                  ? 'Задачи не найдены.'
                  : value.tasks
                      .map((task) => `- [${task.status}] ${task.title} (${task.id}) приоритет ${task.priority}`)
                      .join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const project = currentProject(runtime, exec, args.projectId)
          const tasks = runtime.tasks.list({
            projectId: project.id,
            statuses: args.statuses as TaskStatus[] | undefined,
            assignedAgentId: args.assignedAgentId,
            parentId: args.parentId,
            includeTerminal: args.includeTerminal,
            limit: args.limit,
          })
          return { count: tasks.length, tasks: tasks.map(view) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_get',
        description: 'Прочитать задачу Task Engine по id, включая зависимости, лимиты и результат.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          return view(requireTaskFor(runtime, exec, args.id, 'read'))
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_update',
        description: 'Изменить название, описание, приоритет, агента, лимиты или план незавершённой задачи.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          title: { type: 'string', description: 'Новое название' },
          description: { type: 'string', description: 'Новое описание' },
          goal: { type: 'string', description: 'Новая цель' },
          priority: { type: 'number', description: 'Приоритет 0..100' },
          assignedAgentId: { type: 'string', description: 'id агента; пустая строка — снять' },
          assignedRole: { type: 'string', description: 'Роль' },
          dueAt: { type: 'number', description: 'Срок epoch ms' },
          maxAttempts: { type: 'number', description: 'Максимум попыток' },
          timeoutMs: { type: 'number', description: 'Таймаут, мс' },
          plan: { type: 'json', description: 'Новый план' },
          metadata: { type: 'json', description: 'Метаданные (сливаются)' },
          expectedVersion: { type: 'number', description: 'Ожидаемая версия' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          const task = runtime.tasks.update(args.id, {
            title: args.title,
            description: args.description,
            goal: args.goal,
            priority: args.priority,
            assignedAgentId: args.assignedAgentId === undefined ? undefined : args.assignedAgentId || null,
            assignedRole: args.assignedRole,
            dueAt: args.dueAt,
            maxAttempts: args.maxAttempts,
            timeoutMs: args.timeoutMs,
            plan: args.plan,
            metadata: asObject(args.metadata),
            expectedVersion: args.expectedVersion,
          })
          runtime.auditTool('task.updated', runtime.projects.require(task.projectId), exec, { taskId: task.id })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_claim',
        description:
          'Атомарно взять READY-задачу в RUNNING с lease. Проверяет зависимости, лимит параллельных задач агента и попытки. ' +
          'Возвращает задачу с leaseOwner/leaseUntil; исполнитель обязан периодически вызывать heartbeat.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          owner: { type: 'string', description: 'Владелец lease; по умолчанию id текущей сессии' },
          leaseMinutes: { type: 'number', description: 'Длительность lease в минутах (по умолчанию 15)' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          const task = runtime.tasks.claim(args.id, {
            owner: args.owner?.trim() || exec.agent?.id || 'host',
            leaseMs: leaseMsFromMinutes(args.leaseMinutes, 15 * 60_000),
            actor: exec.agent?.id ?? 'agent',
          })
          runtime.auditTool('task.claimed', runtime.projects.require(task.projectId), exec, {
            taskId: task.id,
            leaseOwner: task.leaseOwner,
          })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_heartbeat',
        description: 'Продлить lease выполняемой задачи. Вызывайте до истечения leaseUntil.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          owner: { type: 'string', description: 'Владелец lease; по умолчанию текущая сессия' },
          leaseMinutes: { type: 'number', description: 'Новая длительность lease в минутах' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          return view(
            runtime.tasks.heartbeat(
              args.id,
              args.owner?.trim() || exec.agent?.id || 'host',
              leaseMsFromMinutes(args.leaseMinutes, 15 * 60_000),
            ),
          )
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_review',
        description: 'Передать выполненную задачу в REVIEW с результатом. Дальше REVIEWER вызывает complete или fail.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          result: { type: 'string', description: 'Результат/артефакты для проверки' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          const task = runtime.tasks.submitForReview(args.id, exec.agent?.id ?? 'agent', args.result ?? null)
          runtime.auditTool('task.review', runtime.projects.require(task.projectId), exec, { taskId: task.id })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_complete',
        description:
          'Завершить RUNNING/REVIEW-задачу. Автоматически переводит зависимые WAITING-задачи в READY, когда все их зависимости завершены.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          result: { type: 'string', description: 'Итог/ссылки на артефакты' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          const task = runtime.tasks.complete(args.id, exec.agent?.id ?? 'agent', args.result ?? null)
          runtime.auditTool('task.completed', runtime.projects.require(task.projectId), exec, { taskId: task.id })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_fail',
        description:
          'Зафиксировать ошибку задачи. При retryable и остатке попыток задача вернётся в READY с экспоненциальной задержкой; иначе станет FAILED.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          error: { type: 'string', required: true, description: 'Текст ошибки' },
          retryable: { type: 'boolean', description: 'Можно ли повторить (по умолчанию true)' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          const task = runtime.tasks.fail(args.id, exec.agent?.id ?? 'agent', args.error, args.retryable ?? true)
          runtime.auditTool('task.failed', runtime.projects.require(task.projectId), exec, {
            taskId: task.id,
            status: task.status,
          })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_cancel',
        description: 'Отменить задачу, которая ещё не завершена. Lease снимается.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          reason: { type: 'string', description: 'Причина отмены' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          const task = runtime.tasks.cancel(args.id, exec.agent?.id ?? 'agent', args.reason ?? '')
          runtime.auditTool('task.cancelled', runtime.projects.require(task.projectId), exec, { taskId: task.id })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_retry',
        description: 'Вернуть FAILED-задачу в READY для новой попытки.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
        },
        output: { schema: TASK_OUTPUT, render: (_args, value) => [{ type: 'text', text: formatTask(value) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'write')
          const task = runtime.tasks.retry(args.id, exec.agent?.id ?? 'agent')
          runtime.auditTool('task.retry', runtime.projects.require(task.projectId), exec, { taskId: task.id })
          return view(task)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_recover',
        description: 'Найти RUNNING-задачи с истёкшим lease и восстановить их: READY при остатке попыток, иначе FAILED. Вызывается автоматически при старте плагина.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { recovered: { type: 'number', required: true } },
          },
          render: (_args, value) => [
            { type: 'text', text: `Восстановлено задач: ${value.recovered}` },
          ],
        },
        async execute(_args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const project = runtime.projectFor(exec)
          const recovered = runtime.tasks.recoverStaleForProject(project.id)
          runtime.audit.record({
            event: 'task.recovered',
            level: 'warn',
            actor: exec.agent?.id ?? 'agent',
            data: { count: recovered, actorProjectId: project.id, targetProjectId: project.id },
          })
          return { recovered }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_events',
        description: 'История событий задачи: создание, claim, retry, review, complete, lease expiry.',
        parameters: {
          id: { type: 'string', required: true, description: 'id задачи' },
          limit: { type: 'number', description: 'Максимум событий (1..200)' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              events: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    ts: { type: 'number', required: true },
                    type: { type: 'string', required: true },
                    actor: { type: 'string', required: true },
                    fromStatus: { type: 'string', required: true },
                    toStatus: { type: 'string', required: true },
                    data: { type: 'json', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                value.count === 0
                  ? 'Событий нет.'
                  : value.events
                      .map(
                        (event) =>
                          `${new Date(event.ts).toISOString()} ${event.type} ${event.fromStatus || '-'} -> ${event.toStatus || '-'} ${JSON.stringify(event.data)}`,
                      )
                      .join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          requireTaskFor(runtime, exec, args.id, 'read')
          const events = runtime.tasks.events(args.id, args.limit)
          return {
            count: events.length,
            events: events.map((event: TaskEvent) => ({
              id: event.id,
              ts: event.ts,
              type: event.type,
              actor: event.actor ?? '',
              fromStatus: event.fromStatus ?? '',
              toStatus: event.toStatus ?? '',
              data: asJsonValue(event.data),
            })),
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_task_stats',
        description: 'Статистика Task Engine по проекту: ready/running/waiting/failed/completed, overdue.',
        parameters: {
          projectId: { type: 'string', description: 'id проекта; пусто — текущий' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'number', required: true },
              active: { type: 'number', required: true },
              ready: { type: 'number', required: true },
              running: { type: 'number', required: true },
              waiting: { type: 'number', required: true },
              failed: { type: 'number', required: true },
              completed: { type: 'number', required: true },
              cancelled: { type: 'number', required: true },
              overdue: { type: 'number', required: true },
              byStatus: { type: 'json', required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `всего: ${value.total}; активных: ${value.active}`,
                `ready ${value.ready} · running ${value.running} · waiting ${value.waiting}`,
                `failed ${value.failed} · completed ${value.completed} · cancelled ${value.cancelled} · overdue ${value.overdue}`,
              ].join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const project = currentProject(runtime, exec, args.projectId)
          const stats = runtime.tasks.stats(project.id)
          return {
            total: stats.total,
            active: stats.active,
            ready: stats.ready,
            running: stats.running,
            waiting: stats.waiting,
            failed: stats.failed,
            completed: stats.completed,
            cancelled: stats.cancelled,
            overdue: stats.overdue,
            byStatus: stats.byStatus,
          }
        },
      }),
    ),
  )

  return disposers
}
