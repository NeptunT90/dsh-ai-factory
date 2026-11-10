import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { AutoWorkflowService } from './auto.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

export function registerAutoWorkflowTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_auto_workflow',
      description:
        'Управление фоновым bounded workflow: status, run (один tick по READY-задачам), start/stop таймера. ' +
        'run можно вызвать без включённого autoWorkflowEnabled; он создаёт coordinator Agent и запускает ' +
        'dispatch → review → fix по READY-задачам. По умолчанию автономный таймер выключен в конфиге.',
      parameters: {
        action: { type: 'string', enum: ['status', 'run', 'start', 'stop'], description: 'Действие' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', required: true },
            enabled: { type: 'boolean', required: true },
            running: { type: 'boolean', required: true },
            timer: { type: 'boolean', required: true },
            results: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  taskId: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                  finalTaskId: { type: 'string', required: true },
                  cycles: { type: 'number', required: true },
                },
              },
            },
            message: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `auto workflow: ${value.action}`,
              `enabled: ${value.enabled ? 'да' : 'нет'} · timer: ${value.timer ? 'да' : 'нет'} · running: ${value.running ? 'да' : 'нет'}`,
              value.message,
              ...value.results.map(
                (result) => `- ${result.taskId}: ${result.status} (${result.cycles} цикл(ов)) → ${result.finalTaskId}`,
              ),
            ]
              .filter((line) => line !== '')
              .join('\n'),
          },
        ],
      },
      timeoutMs: 120 * 60_000,
      async execute(args, exec) {
        const runtime = runtimeOf(getRuntime, getStartupError)
        if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
          throw new FactoryError('FORBIDDEN', 'factory_auto_workflow обрабатывает все проекты и недоступен дочерним агентам')
        }
        const service = runtime.autoWorkflow ?? new AutoWorkflowService(ctx, runtime)
        const action = args.action ?? 'status'
        if (action === 'status') {
          return {
            action,
            enabled: service.enabled,
            running: service.running,
            timer: service.timerActive,
            results: [],
            message: service.enabled ? 'автономный режим разрешён' : 'автономный режим выключен (default)',
          }
        }
        if (action === 'run') {
          const results = await service.tickOnce()
          return {
            action,
            enabled: service.enabled,
            running: service.running,
            timer: service.timerActive,
            results: results.map((result) => ({
              taskId: result.cycles[0]?.taskId ?? result.finalTaskId,
              status: result.status,
              finalTaskId: result.finalTaskId,
              cycles: result.cycles.length,
            })),
            message: results.length === 0 ? 'READY-задач нет' : `обработано: ${results.length}`,
          }
        }
        if (action === 'start') {
          await service.start()
          return {
            action,
            enabled: service.enabled,
            running: service.running,
            timer: service.timerActive,
            results: [],
            message: service.timerActive ? 'таймер запущен' : 'таймер не запущен (autoWorkflowEnabled=false)',
          }
        }
        await service.stop()
        return {
          action,
          enabled: service.enabled,
          running: service.running,
          timer: service.timerActive,
          results: [],
          message: 'таймер остановлен',
        }
      },
    }),
  )
}
