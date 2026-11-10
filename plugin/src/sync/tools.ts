import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError, errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

export function registerSyncTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_sync',
      description:
        'Синхронизировать durable-память с необязательным сервером: status, push (outbox → сервер), pull (изменения сервера → SQLite), sync (push+pull). ' +
        'Локальная работа не зависит от сервера; при ошибке операции остаются в outbox и повторяются с backoff. ' +
        'URL задаётся в syncUrl, токен — только в переменной окружения syncTokenEnv.',
      parameters: {
        action: {
          type: 'string',
          enum: ['status', 'push', 'pull', 'sync'],
          description: 'status — без сети; push/pull/sync — сетевые операции',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', required: true },
            configured: { type: 'boolean', required: true },
            cursor: { type: 'string', required: true },
            auto: { type: 'boolean', required: true },
            running: { type: 'boolean', required: true },
            lastSyncAt: { type: 'number', required: true },
            lastSyncError: { type: 'string', required: true },
            pending: { type: 'number', required: true },
            failed: { type: 'number', required: true },
            accepted: { type: 'number', required: true },
            conflicts: { type: 'number', required: true },
            applied: { type: 'number', required: true },
            skipped: { type: 'number', required: true },
            message: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `sync: ${value.action}`,
              `настроен: ${value.configured ? 'да' : 'нет'} · auto: ${value.auto ? 'вкл' : 'выкл'} · pending: ${value.pending} · failed: ${value.failed}`,
              value.lastSyncAt ? `последний sync: ${new Date(value.lastSyncAt).toISOString()}` : '',
              value.lastSyncError ? `ошибка: ${value.lastSyncError}` : '',
              value.accepted ? `принято сервером: ${value.accepted}` : '',
              value.conflicts ? `конфликтов: ${value.conflicts}` : '',
              value.applied ? `применено локально: ${value.applied}` : '',
              value.skipped ? `пропущено: ${value.skipped}` : '',
              `cursor: ${value.cursor || '—'}`,
              value.message,
            ]
              .filter((line) => line !== '')
              .join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        const runtime = runtimeOf(getRuntime, getStartupError)
        if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
          throw new FactoryError('FORBIDDEN', 'factory_sync — global capability и недоступен дочерним агентам')
        }
        const action = args.action ?? 'status'
        if (action === 'status') {
          const status = runtime.sync.status()
          return {
            action,
            configured: status.configured,
            cursor: status.cursor,
            auto: status.auto,
            running: status.running,
            lastSyncAt: status.lastSyncAt,
            lastSyncError: status.lastSyncError,
            pending: status.pending,
            failed: status.failed,
            accepted: 0,
            conflicts: 0,
            applied: 0,
            skipped: 0,
            message: status.configured
              ? `сервер: ${status.url}; token: ${status.tokenPresent ? 'есть' : 'НЕТ'}; device: ${status.deviceId}`
              : 'syncUrl не задан; локальный режим работает без сервера.',
          }
        }
        try {
          if (action === 'push') {
            const result = await runtime.sync.push()
            return {
              action,
              configured: true,
              cursor: runtime.sync.cursor,
              auto: runtime.sync.status().auto,
              running: runtime.sync.status().running,
              lastSyncAt: runtime.sync.status().lastSyncAt,
              lastSyncError: runtime.sync.status().lastSyncError,
              pending: result.pending,
              failed: 0,
              accepted: result.accepted,
              conflicts: result.conflicts,
              applied: 0,
              skipped: 0,
              message: `отправлено ${result.pushed}`,
            }
          }
          if (action === 'pull') {
            const result = await runtime.sync.pull()
            return {
              action,
              configured: true,
              cursor: result.cursor,
              auto: runtime.sync.status().auto,
              running: runtime.sync.status().running,
              lastSyncAt: runtime.sync.status().lastSyncAt,
              lastSyncError: runtime.sync.status().lastSyncError,
              pending: runtime.sync.pendingCount(),
              failed: 0,
              accepted: 0,
              conflicts: 0,
              applied: result.applied,
              skipped: result.skipped,
              message: 'pull завершён',
            }
          }
          const result = await runtime.sync.sync()
          return {
            action,
            configured: true,
            cursor: runtime.sync.cursor,
            auto: runtime.sync.status().auto,
            running: runtime.sync.status().running,
            lastSyncAt: runtime.sync.status().lastSyncAt,
            lastSyncError: runtime.sync.status().lastSyncError,
            pending: result.push.pending,
            failed: 0,
            accepted: result.push.accepted,
            conflicts: result.push.conflicts,
            applied: result.pull.applied,
            skipped: result.pull.skipped,
            message: 'push+pull завершены',
          }
        } catch (error) {
          throw new FactoryError('UNAVAILABLE', `Sync не выполнен: ${errorMessage(error)}`)
        }
      },
    }),
  )
}
