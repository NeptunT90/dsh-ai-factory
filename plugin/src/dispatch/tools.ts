import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { DispatchService } from './service.js'

const DISPATCH_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string', required: true },
    childId: { type: 'string', required: true },
    agentId: { type: 'string', required: true },
    stopReason: { type: 'string', required: true },
    output: { type: 'string', required: true },
    diagnostic: { type: 'string', required: true },
    taskStatus: { type: 'string', required: true },
  },
} as const

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('STORAGE_UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

export function registerDispatchTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_dispatch',
      description:
        'Запустить реального дочернего агента через официальный ctx.subagents (провайдер spawn), дождаться результата и завершить связанную задачу Task Engine. ' +
        'Дочерний агент работает в отдельной сессии, получает роль/инструкцию профиля и справочный контекст памяти. ' +
        'Задача должна быть READY; при успехе она станет COMPLETED, при ошибке — READY (retry) или FAILED. ' +
        'Это синхронный вызов: инструмент возвращается после завершения ребёнка.',
      parameters: {
        taskId: { type: 'string', required: true, description: 'id READY-задачи' },
        agentId: { type: 'string', description: 'Профиль агента; по умолчанию назначенный задаче или EXECUTOR' },
        prompt: { type: 'string', description: 'Дополнительные указания дочернему агенту' },
        provider: { type: 'string', description: 'Провайдер subagents (по умолчанию spawn)' },
        leaseMinutes: { type: 'number', description: 'Lease задачи в минутах (по умолчанию 30)' },
      },
      output: {
        schema: DISPATCH_OUTPUT,
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `Задача ${value.taskId}: ${value.taskStatus}`,
              `дочерний агент: ${value.childId} (${value.agentId})`,
              `остановка: ${value.stopReason}`,
              value.diagnostic ? `диагностика: ${value.diagnostic}` : '',
              '',
              value.output || '(дочерний агент не вернул текст)',
            ]
              .filter((line) => line !== '')
              .join('\n'),
          },
        ],
      },
      // A child run may legitimately take many minutes; the cooperative timeout
      // remains below the 30-minute task lease default plus one heartbeat.
      timeoutMs: 45 * 60 * 1000,
      async execute(args, exec) {
        const runtime = runtimeOf(getRuntime, getStartupError)
        return new DispatchService(ctx, runtime).dispatch(args, exec)
      },
    }),
  )
}
