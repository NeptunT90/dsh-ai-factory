import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { MetricsService } from './service.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  return runtime
}

export function registerMetricsTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_metrics',
      description: 'Read-only метрики проекта: success rate, avg attempts, retry rate и топ ошибок инструментов. Root-only.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tasksTotal: { type: 'number', required: true },
            completed: { type: 'number', required: true },
            failed: { type: 'number', required: true },
            successRate: { type: 'number', required: true },
            avgAttempts: { type: 'number', required: true },
            retryRate: { type: 'number', required: true },
            toolErrorTop: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tool: { type: 'string', required: true },
                  errorCode: { type: 'string', required: true },
                  count: { type: 'number', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `задачи: ${value.tasksTotal}; completed ${value.completed}; failed ${value.failed}`,
              `success_rate: ${value.successRate.toFixed(2)}; avg_attempts: ${value.avgAttempts.toFixed(2)}; retry_rate: ${value.retryRate.toFixed(2)}`,
              ...(value.toolErrorTop.length ? value.toolErrorTop.map((error) => `- ${error.tool}: ${error.errorCode} × ${error.count}`) : ['tool errors: нет']),
            ].join('\n'),
          },
        ],
      },
      async execute(_args, exec) {
        const runtime = runtimeOf(getRuntime, getStartupError)
        if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
          throw new FactoryError('FORBIDDEN', 'factory_metrics доступен только root/DIRECTOR')
        }
        const project = runtime.projectFor(exec)
        const metrics = new MetricsService(runtime.db).project(project.id)
        return { ...metrics, toolErrorTop: metrics.toolErrorTop.map((error) => ({ ...error })) }
      },
    }),
  )
}
