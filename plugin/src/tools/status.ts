import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { FactoryRuntime } from '../runtime.js'
import { FACTORY_VERSION } from '../runtime.js'

const STATUS_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true },
    version: { type: 'string', required: true },
    driver: { type: 'string', required: true },
    dbPath: { type: 'string', required: true },
    dataDir: { type: 'string', required: true },
    schemaVersion: { type: 'number', required: true },
    uptimeMs: { type: 'number', required: true },
    projects: { type: 'number', required: true },
    agents: { type: 'number', required: true },
    tasks: { type: 'number', required: true },
    recoveredTasks: { type: 'number', required: true },
    activeMemory: { type: 'number', required: true },
    totalMemory: { type: 'number', required: true },
    byKind: { type: 'json', required: true },
    error: { type: 'string', required: true },
  },
} as const

/**
 * Register the always-available diagnostics tool. It is registered even when
 * storage failed, so the failure is inspectable from the chat instead of being
 * hidden behind a missing tool.
 */
export function registerStatusTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_status',
      description:
        'Показать состояние DSH AI Factory: драйвер и путь хранилища, версию схемы, проекты, объём памяти и ошибку запуска. ' +
        'Используйте этот инструмент для диагностики перед работой с памятью.',
      parameters: {},
      output: {
        schema: STATUS_OUTPUT,
        render: (_args, value) => {
          if (value.status === 'error') {
            return [
              {
                type: 'text',
                text: `DSH AI Factory: ОШИБКА\n${value.error}\n\nПодсказка: проверьте лог DSH и конфигурацию dataDir/dbFile.`,
              },
            ]
          }
          return [
            {
              type: 'text',
              text: [
                `DSH AI Factory ${value.version}: работает`,
                `хранилище: ${value.driver}`,
                `БД: ${value.dbPath}`,
                `схема: v${value.schemaVersion}`,
                `проектов: ${value.projects}`,
                `агентов: ${value.agents} · задач: ${value.tasks} · восстановлено: ${value.recoveredTasks}`,
                `память: ${value.activeMemory} активных / ${value.totalMemory} всего`,
                `по типам: ${JSON.stringify(value.byKind)}`,
                `uptime: ${Math.round(value.uptimeMs / 1000)} с`,
              ].join('\n'),
            },
          ]
        },
      },
      async execute() {
        const runtime = getRuntime()
        const startupError = getStartupError()
        if (!runtime) {
          return {
            status: 'error',
            version: FACTORY_VERSION,
            driver: 'unavailable',
            dbPath: '',
            dataDir: '',
            schemaVersion: 0,
            uptimeMs: 0,
            projects: 0,
            agents: 0,
            tasks: 0,
            recoveredTasks: 0,
            activeMemory: 0,
            totalMemory: 0,
            byKind: {},
            error: startupError ?? 'AI Factory не инициализирован',
          }
        }
        const status = runtime.status()
        return {
          status: status.status,
          version: status.version,
          driver: status.driver,
          dbPath: status.dbPath,
          dataDir: status.dataDir,
          schemaVersion: status.schemaVersion,
          uptimeMs: status.uptimeMs,
          projects: status.projects,
          agents: status.agents,
          tasks: status.tasks,
          recoveredTasks: status.recoveredTasks,
          activeMemory: status.memory.activeEntries,
          totalMemory: status.memory.totalEntries,
          byKind: status.memory.byKind,
          error: '',
        }
      },
    }),
  )
}
