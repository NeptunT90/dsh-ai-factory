import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import { asJsonValue, type JsonValue } from '../core/json.js'
import type { FactoryRuntime } from '../runtime.js'
import {
  ACCESS_LEVELS,
  AGENT_ROLES,
  MEMORY_SCOPES,
  type AccessLevel,
  type AgentLimits,
  type AgentMemoryScope,
  type AgentProfile,
  type AgentRole,
} from '../agents/types.js'

const AGENT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true },
    title: { type: 'string', required: true },
    description: { type: 'string', required: true },
    systemInstruction: { type: 'string', required: true },
    modelProvider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    reasoningEffort: { type: 'string', required: true },
    tools: { type: 'array', items: { type: 'string' }, required: true },
    accessLevel: { type: 'string', required: true },
    memoryScope: { type: 'string', required: true },
    limits: { type: 'json', required: true },
    enabled: { type: 'boolean', required: true },
    isBuiltin: { type: 'boolean', required: true },
    version: { type: 'number', required: true },
    createdAt: { type: 'number', required: true },
    updatedAt: { type: 'number', required: true },
  },
} as const

function view(agent: AgentProfile): AgentView {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role as string,
    title: agent.title,
    description: agent.description,
    systemInstruction: agent.systemInstruction,
    modelProvider: agent.modelProvider ?? '',
    model: agent.model ?? '',
    reasoningEffort: agent.reasoningEffort ?? '',
    tools: [...agent.tools],
    accessLevel: agent.accessLevel,
    memoryScope: agent.memoryScope,
    limits: asJsonValue(agent.limits),
    enabled: agent.enabled,
    isBuiltin: agent.isBuiltin,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  }
}

interface AgentView {
  id: string
  name: string
  role: string
  title: string
  description: string
  systemInstruction: string
  modelProvider: string
  model: string
  reasoningEffort: string
  tools: string[]
  accessLevel: string
  memoryScope: string
  limits: JsonValue
  enabled: boolean
  isBuiltin: boolean
  version: number
  createdAt: number
  updatedAt: number
}

function asLimits(value: unknown): Partial<AgentLimits> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Partial<AgentLimits>
}

function formatAgent(agent: AgentView): string {
  return [
    `# ${agent.name} (${agent.role})${agent.enabled ? '' : ' — ОТКЛЮЧЁН'}`,
    `${agent.title} · доступ: ${agent.accessLevel} · память: ${agent.memoryScope}`,
    agent.model ? `модель: ${agent.modelProvider ?? 'default'}/${agent.model}` : 'модель: по умолчанию',
    `лимиты: ${JSON.stringify(agent.limits)}`,
    `инструменты: ${agent.tools.join(', ') || '—'}`,
    '',
    agent.description,
    '',
    agent.systemInstruction,
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

export function registerAgentTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_agent_list',
        description:
          'Список профилей специалистов AI Factory: DIRECTOR, RESEARCHER, DEVELOPER, SYSADMIN, ANALYST, EXECUTOR, REVIEWER и пользовательские. ' +
          'Профиль задаёт роль, инструкцию, рекомендуемые инструменты, доступ и лимиты; это ещё не запущенный LLM-агент.',
        parameters: {
          role: { type: 'string', enum: AGENT_ROLES, description: 'Фильтр по роли.' },
          enabledOnly: { type: 'boolean', description: 'Только включённые профили.' },
          limit: { type: 'number', description: 'Максимум профилей (1..200).' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              agents: { type: 'array', items: AGENT_OUTPUT, required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                value.count === 0
                  ? 'Профили не найдены.'
                  : value.agents
                      .map((agent) => `- ${agent.name} (${agent.role}) · ${agent.enabled ? 'вкл' : 'выкл'} · ${agent.id}`)
                      .join('\n'),
            },
          ],
        },
        async execute(args) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const agents = runtime.agents.list({
            role: args.role as AgentRole | undefined,
            enabledOnly: args.enabledOnly,
            limit: args.limit,
          })
          return { count: agents.length, agents: agents.map(view) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_agent_get',
        description: 'Прочитать полный профиль специалиста AI Factory по id.',
        parameters: {
          id: { type: 'string', required: true, description: 'id вида agt_...' },
        },
        output: {
          schema: AGENT_OUTPUT,
          render: (_args, value) => [{ type: 'text', text: formatAgent(value) }],
        },
        async execute(args) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          return view(runtime.agents.require(args.id))
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_agent_save',
        description:
          'Создать или отредактировать профиль специалиста AI Factory. ' +
          'Без id создаёт нового агента; с id обновляет существующего с сохранением версии. ' +
          'Профиль — это конфигурация роли, а не запущенный процесс.',
        parameters: {
          id: { type: 'string', description: 'id для обновления; пусто — создать' },
          name: { type: 'string', description: 'Уникальное имя (обязательно при создании)' },
          role: { type: 'string', enum: AGENT_ROLES, description: 'Роль специалиста' },
          title: { type: 'string', description: 'Короткое отображаемое имя' },
          description: { type: 'string', description: 'Назначение профиля' },
          systemInstruction: { type: 'string', description: 'Системная инструкция агента' },
          modelProvider: { type: 'string', description: 'Провайдер модели (пусто — default)' },
          model: { type: 'string', description: 'id модели (пусто — default)' },
          reasoningEffort: { type: 'string', description: 'Уровень reasoning' },
          tools: { type: 'array', items: { type: 'string' }, description: 'Рекомендуемые инструменты/паттерны' },
          accessLevel: { type: 'string', enum: ACCESS_LEVELS, description: 'Уровень доступа' },
          memoryScope: { type: 'string', enum: MEMORY_SCOPES, description: 'Доступ к памяти' },
          limits: { type: 'json', description: 'Лимиты: maxConcurrentTasks, maxAttempts, timeoutMs, autonomy' },
          enabled: { type: 'boolean', description: 'Включён ли профиль' },
          expectedVersion: { type: 'number', description: 'Ожидаемая версия при обновлении' },
        },
        output: {
          schema: AGENT_OUTPUT,
          render: (_args, value) => [{ type: 'text', text: formatAgent(value) }],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const limits = asLimits(args.limits)
          const agent = args.id
            ? runtime.agents.update(args.id, {
                name: args.name,
                role: args.role as AgentRole | undefined,
                title: args.title,
                description: args.description,
                systemInstruction: args.systemInstruction,
                modelProvider: args.modelProvider,
                model: args.model,
                reasoningEffort: args.reasoningEffort,
                tools: args.tools,
                accessLevel: args.accessLevel as AccessLevel | undefined,
                memoryScope: args.memoryScope as AgentMemoryScope | undefined,
                limits,
                enabled: args.enabled,
                expectedVersion: args.expectedVersion,
              })
            : runtime.agents.create({
                name: args.name ?? '',
                role: args.role as AgentRole | undefined,
                title: args.title,
                description: args.description,
                systemInstruction: args.systemInstruction,
                modelProvider: args.modelProvider,
                model: args.model,
                reasoningEffort: args.reasoningEffort,
                tools: args.tools,
                accessLevel: args.accessLevel as AccessLevel | undefined,
                memoryScope: args.memoryScope as AgentMemoryScope | undefined,
                limits,
                enabled: args.enabled,
              })
          runtime.audit.record({
            event: args.id ? 'agent.updated' : 'agent.created',
            level: 'info',
            actor: exec.agent?.id ?? 'agent',
            data: { agentId: agent.id, role: agent.role, version: agent.version },
          })
          return view(agent)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_agent_toggle',
        description: 'Включить или отключить профиль специалиста. Отключённому профилю нельзя назначать новые задачи.',
        parameters: {
          id: { type: 'string', required: true, description: 'id профиля' },
          enabled: { type: 'boolean', required: true, description: 'true — включить, false — отключить' },
        },
        output: {
          schema: AGENT_OUTPUT,
          render: (_args, value) => [{ type: 'text', text: formatAgent(value) }],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          const agent = runtime.agents.setEnabled(args.id, args.enabled)
          runtime.audit.record({
            event: 'agent.toggled',
            level: 'info',
            actor: exec.agent?.id ?? 'agent',
            data: { agentId: agent.id, enabled: agent.enabled },
          })
          return view(agent)
        },
      }),
    ),
  )

  return disposers
}
