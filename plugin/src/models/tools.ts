import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import { AGENT_ROLES, type AgentRole } from '../agents/types.js'
import type { FactoryRuntime } from '../runtime.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

function routeLabel(route: { provider: string; model: string }): string {
  return `${route.provider}/${route.model}`
}

export function registerModelTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_model_route',
      description:
        'Показать разрешённый Model Router маршрут для профиля: primary, fallback-цепочку и лимит попыток. ' +
        'Read-only: не меняет профиль и не запускает модель. Приоритет: модель профиля → модель родителя → modelFallbacks.',
      parameters: {
        role: { type: 'string', enum: AGENT_ROLES, description: 'Роль профиля (по умолчанию executor)' },
        agentId: { type: 'string', description: 'Конкретный профиль agt_... (приоритетнее role)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', required: true },
            agentId: { type: 'string', required: true },
            agentName: { type: 'string', required: true },
            primary: { type: 'string', required: true },
            fallbacks: { type: 'array', items: { type: 'string' }, required: true },
            attempts: { type: 'array', items: { type: 'string' }, required: true },
            maxAttempts: { type: 'number', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `model route: ${value.agentName} (${value.agentId})`,
              `router: ${value.enabled ? 'включён' : 'выключен'} · попыток: ${value.maxAttempts}`,
              `primary: ${value.primary || '—'}`,
              value.fallbacks.length > 0 ? `fallbacks: ${value.fallbacks.join(', ')}` : 'fallbacks: —',
              `chain: ${value.attempts.join(' → ') || '—'}`,
            ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        const runtime = runtimeOf(getRuntime, getStartupError)
        const agent = args.agentId
          ? runtime.agents.require(args.agentId)
          : runtime.agents.findByRole((args.role as AgentRole | undefined) ?? 'executor')
        if (!agent) throw new FactoryError('NOT_FOUND', 'Профиль для model route не найден')
        if (!exec.agent) throw new FactoryError('UNAVAILABLE', 'factory_model_route требует вызывающего агента')
        const plan = runtime.models.plan(agent, exec.agent)
        return {
          enabled: plan.enabled,
          agentId: agent.id,
          agentName: agent.name,
          primary: plan.primary ? routeLabel(plan.primary) : '',
          fallbacks: plan.fallbacks.map((route) => routeLabel(route)),
          attempts: plan.attempts.map((route) => routeLabel(route)),
          maxAttempts: plan.maxAttempts,
        }
      },
    }),
  )
}
