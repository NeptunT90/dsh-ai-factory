import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SkillStore } from '../skills/store.js'
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
    allowedTools: { type: 'array', items: { type: 'string' }, required: true },
    skills: { type: 'array', items: { type: 'string' }, required: true },
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
    allowedTools: [...agent.allowedTools],
    skills: [...agent.skills],
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
  allowedTools: string[]
  skills: string[]
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
    `allowlist: ${agent.allowedTools.join(', ') || '—'}`,
    '',
    agent.description,
    '',
    agent.systemInstruction,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function callerToolNames(ctx: Context, exec: ToolRunContext): Set<string> {
  if (!exec.agent) throw new FactoryError('FORBIDDEN', 'factory_agent_save требует вызывающего агента')
  const definitions = ctx.tools.definitions(exec.agent)
  return new Set(definitions.map((definition) => definition.name))
}

function accessRank(level: string): number {
  const index = (ACCESS_LEVELS as readonly string[]).indexOf(level)
  return index < 0 ? -1 : index
}

function denyAgentChange(
  runtime: FactoryRuntime,
  exec: ToolRunContext,
  reason: 'child_forbidden' | 'builtin_protected' | 'access_level_higher' | 'caller_subset',
  args: { id?: string; requestedAllowedTools?: string[]; missingAllowedTools?: string[]; callerAccessLevel?: string; targetAccessLevel?: string },
): never {
  runtime.auditTool('agent.grant_denied', null, exec, {
    agentId: args.id ?? null,
    reason,
    ...(args.requestedAllowedTools === undefined ? {} : { requestedAllowedTools: args.requestedAllowedTools }),
    ...(args.missingAllowedTools === undefined ? {} : { missingAllowedTools: args.missingAllowedTools }),
    ...(args.callerAccessLevel === undefined ? {} : { callerAccessLevel: args.callerAccessLevel }),
    ...(args.targetAccessLevel === undefined ? {} : { targetAccessLevel: args.targetAccessLevel }),
  })
  if (reason === 'child_forbidden') {
    throw new FactoryError('FORBIDDEN', 'Изменение профилей доступно только root/DIRECTOR; дочерний агент не может менять профили')
  }
  if (reason === 'builtin_protected') {
    throw new FactoryError('FORBIDDEN', 'Встроенный профиль защищён от изменения и отключения', { agentId: args.id })
  }
  if (reason === 'access_level_higher') {
    throw new FactoryError(
      'FORBIDDEN',
      'Нельзя изменить профиль с уровнем доступа выше уровня вызывающего агента',
      { callerAccessLevel: args.callerAccessLevel, targetAccessLevel: args.targetAccessLevel },
    )
  }
  throw new FactoryError(
    'FORBIDDEN',
    'Нельзя выдать агенту инструменты, которых нет у вызывающего агента',
    { requestedAllowedTools: args.requestedAllowedTools, missingAllowedTools: args.missingAllowedTools },
  )
}

export function assertAgentTargetMutable(
  runtime: FactoryRuntime,
  exec: ToolRunContext,
  args: { id?: string; accessLevel?: AccessLevel },
): void {
  if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
    denyAgentChange(runtime, exec, 'child_forbidden', { id: args.id })
  }
  const target = args.id ? runtime.agents.get(args.id) : undefined
  if (target?.isBuiltin === true) {
    denyAgentChange(runtime, exec, 'builtin_protected', {
      id: target.id,
      targetAccessLevel: target.accessLevel,
    })
  }
  const callerAccessLevel = runtime.agentAccessLevel(exec.agent?.id)
  const requestedAccessLevel = args.accessLevel ?? target?.accessLevel ?? 'workspace'
  if (accessRank(callerAccessLevel) < accessRank(requestedAccessLevel)) {
    denyAgentChange(runtime, exec, 'access_level_higher', {
      id: args.id,
      callerAccessLevel,
      targetAccessLevel: requestedAccessLevel,
    })
  }
}

function assertAgentSaveAllowed(
  ctx: Context,
  runtime: FactoryRuntime,
  exec: ToolRunContext,
  args: { id?: string; name?: string; allowedTools?: string[]; accessLevel?: AccessLevel },
): void {
  assertAgentTargetMutable(runtime, exec, args)
  if (args.allowedTools === undefined) return
  const requested = [...new Set(args.allowedTools.map((tool) => tool.trim()).filter((tool) => tool !== ''))]
  const callerTools = callerToolNames(ctx, exec)
  const missing = requested.filter((tool) => !callerTools.has(tool))
  if (missing.length > 0) {
    denyAgentChange(runtime, exec, 'caller_subset', {
      id: args.id,
      requestedAllowedTools: requested,
      missingAllowedTools: missing,
    })
  }
}

function assertAgentToggleAllowed(
  runtime: FactoryRuntime,
  exec: ToolRunContext,
  args: { id: string },
): void {
  assertAgentTargetMutable(runtime, exec, args)
}

function assertSkillsExist(
  runtime: FactoryRuntime,
  exec: ToolRunContext,
  skills: readonly string[] | undefined,
): void {
  if (skills === undefined) return
  const store = new SkillStore(runtime.projectFor(exec).rootPath)
  for (const id of [...new Set(skills.map((skill) => skill.trim()).filter((skill) => skill !== ''))]) {
    try {
      const skill = store.get(id)
      if (!skill.enabled) {
        throw new FactoryError('SKILL_NOT_FOUND', `Навык ${id} отключён`, { skillId: id, reason: 'disabled' })
      }
    } catch (error) {
      if (error instanceof FactoryError) {
        throw new FactoryError('SKILL_NOT_FOUND', `Навык ${id} не найден в текущем проекте`, {
          skillId: id,
          reason: error.code,
        })
      }
      throw error
    }
  }
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
          allowedTools: { type: 'array', items: { type: 'string' }, description: 'Точный allowlist инструментов ребёнка' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Project-local skill ids для профиля' },
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
          assertAgentSaveAllowed(ctx, runtime, exec, args)
          assertSkillsExist(runtime, exec, args.skills)
          const previousSkills = args.id ? [...runtime.agents.require(args.id).skills] : []
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
                allowedTools: args.allowedTools,
                skills: args.skills,
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
                allowedTools: args.allowedTools,
                skills: args.skills,
                accessLevel: args.accessLevel as AccessLevel | undefined,
                memoryScope: args.memoryScope as AgentMemoryScope | undefined,
                limits,
                enabled: args.enabled,
              })
          if (args.skills !== undefined && JSON.stringify(previousSkills) !== JSON.stringify(agent.skills)) {
            runtime.auditTool('agent.skills_changed', null, exec, {
              agentId: agent.id,
              oldSkillIds: previousSkills,
              newSkillIds: [...agent.skills],
            })
          }
          runtime.auditTool(args.id ? 'agent.updated' : 'agent.created', null, exec, {
            agentId: agent.id,
            role: agent.role,
            version: agent.version,
            allowedToolsCount: agent.allowedTools.length,
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
          assertAgentToggleAllowed(runtime, exec, args)
          const agent = runtime.agents.setEnabled(args.id, args.enabled)
          runtime.auditTool('agent.toggled', null, exec, { agentId: agent.id, enabled: agent.enabled })
          return view(agent)
        },
      }),
    ),
  )

  return disposers
}
