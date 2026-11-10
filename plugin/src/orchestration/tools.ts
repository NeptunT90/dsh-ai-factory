import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { AGENT_ROLES, type AgentRole } from '../agents/types.js'
import type { PlanStepInput } from '../planner/service.js'
import type { TaskRecord } from '../tasks/types.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('STORAGE_UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

const STEP_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', required: true },
    taskId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
    assignedAgentId: { type: 'string', required: true },
    dependsOn: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const PLAN_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    parentId: { type: 'string', required: true },
    parentTitle: { type: 'string', required: true },
    parentStatus: { type: 'string', required: true },
    count: { type: 'number', required: true },
    steps: { type: 'array', items: STEP_RESULT, required: true },
  },
} as const

function formatTaskLine(task: TaskRecord): string {
  const agent = task.assignedRole ? ` [${task.assignedRole}]` : ''
  return `- ${task.status}${agent} ${task.title} (${task.id})`
}

export function registerOrchestrationTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_plan_create',
        description:
          'Сохранить декомпозицию цели как родительский план и набор durable-задач с зависимостями. ' +
          'Модель предлагает шаги; плагин проверяет DAG, назначает профили по ролям и создаёт Task Engine записи. ' +
          'Шаги без зависимостей становятся READY, остальные — WAITING и автоматически станут READY после завершения зависимостей.',
        parameters: {
          goal: { type: 'string', required: true, description: 'Конечная цель' },
          title: { type: 'string', description: 'Название плана' },
          steps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string', required: true, description: 'Уникальный ключ шага (A-Za-z0-9_-)' },
                title: { type: 'string', required: true, description: 'Название шага' },
                description: { type: 'string', description: 'Что сделать' },
                role: { type: 'string', enum: AGENT_ROLES, description: 'Роль исполнителя' },
                agentId: { type: 'string', description: 'Конкретный профиль агента' },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ключи шагов-зависимостей' },
                priority: { type: 'number', description: 'Приоритет 0..100' },
                maxAttempts: { type: 'number', description: 'Максимум попыток' },
                timeoutMs: { type: 'number', description: 'Таймаут, мс' },
                requiresCapabilities: { type: 'array', items: { type: 'string' }, description: 'Capability ids, проверяемые по кэшу до создания плана' },
              },
            },
          },
        },
        output: {
          schema: PLAN_OUTPUT,
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `План создан: ${value.parentTitle}`,
                `parent: ${value.parentId} (${value.parentStatus}); шагов: ${value.count}`,
                '',
                ...value.steps.map(
                  (step) =>
                    `- [${step.key}] ${step.title} → ${step.taskId} (${step.status})` +
                    (step.dependsOn.length ? ` после ${step.dependsOn.join(', ')}` : ''),
                ),
              ].join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const project = runtime.projectFor(exec)
          const steps: PlanStepInput[] = args.steps.map((step) => ({
            key: step.key,
            title: step.title,
            description: step.description,
            role: step.role as AgentRole | undefined,
            agentId: step.agentId,
            dependsOn: step.dependsOn,
            priority: step.priority,
            maxAttempts: step.maxAttempts,
            timeoutMs: step.timeoutMs,
            requiresCapabilities: step.requiresCapabilities,
          }))
          const result = runtime.planner.createPlan({
            projectId: project.id,
            goal: args.goal,
            title: args.title,
            steps,
            createdBy: exec.agent?.id ?? 'agent',
          })
          runtime.auditTool('plan.created', project, exec, {
            parentId: result.parent.id,
            steps: result.steps.length,
          })
          return {
            parentId: result.parent.id,
            parentTitle: result.parent.title,
            parentStatus: result.parent.status,
            count: result.steps.length,
            steps: result.steps.map((step) => ({
              key: step.key,
              taskId: step.taskId,
              title: step.title,
              status: step.status,
              assignedAgentId: step.assignedAgentId ?? '',
              dependsOn: [...step.dependsOn],
            })),
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_director_brief',
        description:
          'Оперативный брифинг DIRECTOR по текущему проекту: агенты, задачи, статистика, последние записи памяти и следующие действия. ' +
          'Не запускает LLM и не выполняет работу сам — даёт главному агенту фактическое состояние фабрики.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              projectId: { type: 'string', required: true },
              projectName: { type: 'string', required: true },
              projectRoot: { type: 'string', required: true },
              autonomy: { type: 'string', required: true },
              agents: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                    role: { type: 'string', required: true },
                    enabled: { type: 'boolean', required: true },
                  },
                },
              },
              tasks: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  total: { type: 'number', required: true },
                  active: { type: 'number', required: true },
                  ready: { type: 'number', required: true },
                  running: { type: 'number', required: true },
                  failed: { type: 'number', required: true },
                  completed: { type: 'number', required: true },
                  overdue: { type: 'number', required: true },
                },
              },
              openTasks: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    priority: { type: 'number', required: true },
                    assignedRole: { type: 'string', required: true },
                  },
                },
              },
              recentMemory: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    snippet: { type: 'string', required: true },
                  },
                },
              },
              nextActions: { type: 'array', items: { type: 'string' }, required: true },
              capabilities: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  checkedAt: { type: 'number', required: true },
                  scanId: { type: 'string', required: true },
                  available: { type: 'number', required: true },
                  unavailable: { type: 'number', required: true },
                  stale: { type: 'number', required: true },
                  unknown: { type: 'number', required: true },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `DIRECTOR BRIEF — ${value.projectName} (${value.projectId})`,
                `root: ${value.projectRoot}`,
                `автономность: ${value.autonomy}`,
                `задачи: ${value.tasks.active} активных, ready ${value.tasks.ready}, running ${value.tasks.running}, failed ${value.tasks.failed}, overdue ${value.tasks.overdue}`,
                '',
                'Агенты:',
                ...value.agents.map((agent) => `- ${agent.name} [${agent.role}] ${agent.enabled ? 'вкл' : 'выкл'}`),
                '',
                'Открытые задачи:',
                ...(value.openTasks.length
                  ? value.openTasks.map((task) => `- [${task.status}] ${task.title} (${task.id})`)
                  : ['- нет']),
                '',
                `capabilities: ${value.capabilities.available} available · ${value.capabilities.unavailable} unavailable · ${value.capabilities.stale} stale · ${value.capabilities.unknown} unknown`,
                '',
                'Следующие действия:',
                ...value.nextActions.map((action) => `- ${action}`),
              ].join('\n'),
            },
          ],
        },
        async execute(_args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const project = runtime.projectFor(exec)
          const stats = runtime.tasks.stats(project.id)
          const agents = runtime.agents.list({ limit: 100 })
          const openTasks = runtime.tasks.list({ projectId: project.id, limit: 20 })
          const memory = runtime.memory.search({ projectId: project.id, includeGlobal: true, limit: 5 })
          const capabilitySummary = runtime.capabilities.summary()
          const nextActions: string[] = []
          if (stats.failed > 0) nextActions.push('Разобрать FAILED-задачи и вызвать factory_task_retry или исправить причину.')
          if (stats.ready > 0) nextActions.push('Взять READY-задачу через factory_task_claim и выполнить её.')
          if (openTasks.some((task) => task.status === 'REVIEW')) {
            nextActions.push('Проверить REVIEW-задачи через REVIEWER и завершить или вернуть на исправление.')
          }
          if (stats.total === 0) nextActions.push('Создать план через factory_plan_create или одну задачу через factory_task_create.')
          if (nextActions.length === 0) nextActions.push('Открытых действий нет; сформировать отчёт пользователю.')
          runtime.auditTool('director.brief', project, exec, { tasks: stats.total })
          return {
            projectId: project.id,
            projectName: project.name,
            projectRoot: project.rootPath,
            autonomy: runtime.config.defaultAutonomy,
            agents: agents.map((agent) => ({
              id: agent.id,
              name: agent.name,
              role: agent.role,
              enabled: agent.enabled,
            })),
            tasks: {
              total: stats.total,
              active: stats.active,
              ready: stats.ready,
              running: stats.running,
              failed: stats.failed,
              completed: stats.completed,
              overdue: stats.overdue,
            },
            openTasks: openTasks.map((task) => ({
              id: task.id,
              title: task.title,
              status: task.status,
              priority: task.priority,
              assignedRole: task.assignedRole ?? '',
            })),
            recentMemory: memory.map((hit) => ({
              id: hit.id,
              kind: hit.kind,
              title: hit.title,
              snippet: hit.snippet,
            })),
            nextActions,
            capabilities: {
              checkedAt: capabilitySummary.checkedAt,
              scanId: capabilitySummary.scanId ?? '',
              available: capabilitySummary.available,
              unavailable: capabilitySummary.unavailable,
              stale: capabilitySummary.stale,
              unknown: capabilitySummary.unknown,
            },
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_tools_list',
        description:
          'Показать фактические инструменты, зарегистрированные в DSH и видимые текущему агенту, с описаниями. ' +
          'Используйте для проверки доступности перед назначением работы; это чтение реестра хоста, не подмена.',
        parameters: {
          query: { type: 'string', description: 'Фильтр по имени/описанию' },
          limit: { type: 'number', description: 'Максимум инструментов (1..200)' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              tools: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true },
                    description: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.count === 0
                ? 'Инструменты не найдены.'
                : value.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 100)))
          const query = args.query?.trim().toLowerCase() ?? ''
          const definitions = ctx.tools.definitions(exec.agent)
          const tools = definitions
            .filter(
              (tool) =>
                query === '' ||
                tool.name.toLowerCase().includes(query) ||
                tool.description.toLowerCase().includes(query),
            )
            .slice(0, limit)
            .map((tool) => ({ name: tool.name, description: tool.description.slice(0, 300) }))
          return { count: tools.length, tools }
        },
      }),
    ),
  )

  return disposers
}
