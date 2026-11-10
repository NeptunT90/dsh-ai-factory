import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError, errorMessage } from '../core/errors.js'
import type { FactoryRuntime, PluginLogger } from '../runtime.js'
import type { DashboardTool } from './server.js'
import { DashboardServer } from './server.js'

export interface DashboardStatus {
  readonly running: boolean
  readonly url: string
  readonly token: string
  readonly port: number
}

export class DashboardManager {
  private server: DashboardServer | undefined

  constructor(
    private readonly getRuntime: () => FactoryRuntime | undefined,
    private readonly getTools: () => readonly DashboardTool[],
    private readonly logger: PluginLogger,
  ) {}

  async start(port = 0): Promise<DashboardStatus> {
    const runtime = this.getRuntime()
    if (!runtime) throw new FactoryError('UNAVAILABLE', 'AI Factory не инициализирован')
    if (this.server?.running) {
      return {
        running: true,
        url: this.server.url,
        token: this.server.token,
        port: new URL(this.server.url).port ? Number(new URL(this.server.url).port) : 0,
      }
    }
    const server = new DashboardServer(runtime, this.getTools, { port })
    const started = await server.start()
    this.server = server
    runtime.audit.record({
      event: 'dashboard.started',
      level: 'info',
      data: { port: started.port, readOnly: true, bind: '127.0.0.1' },
    })
    this.logger.info(`[ai-factory] dashboard started on 127.0.0.1:${started.port}`)
    return { running: true, url: started.url, token: started.token, port: started.port }
  }

  status(): DashboardStatus {
    const server = this.server
    if (!server?.running) return { running: false, url: '', token: '', port: 0 }
    let port = 0
    try {
      port = Number(new URL(server.url).port)
    } catch {
      port = 0
    }
    return { running: true, url: server.url, token: server.token, port }
  }

  async stop(): Promise<DashboardStatus> {
    const server = this.server
    if (!server) return { running: false, url: '', token: '', port: 0 }
    try {
      await server.stop()
    } catch (error) {
      this.logger.warn(`[ai-factory] dashboard stop failed: ${errorMessage(error)}`)
    }
    this.server = undefined
    const runtime = this.getRuntime()
    runtime?.audit.record({ event: 'dashboard.stopped', level: 'info', data: {} })
    return { running: false, url: '', token: '', port: 0 }
  }

  async close(): Promise<void> {
    if (this.server) {
      await this.server.stop().catch(() => undefined)
      this.server = undefined
    }
  }
}

export function registerDashboardTool(ctx: Context, manager: DashboardManager): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_dashboard',
      description:
        'Локальная read-only панель управления AI Factory: обзор, агенты, задачи, память, журнал, инструменты, настройки. ' +
        'Запускает HTTP-сервер только на 127.0.0.1 со случайным токеном; мутаций нет. ' +
        'Верните пользователю URL из результата.',
      parameters: {
        action: {
          type: 'string',
          enum: ['start', 'status', 'stop'],
          description: 'start — запустить/получить URL; status — состояние; stop — остановить',
        },
        port: {
          type: 'number',
          description: 'Порт 0..65535 (0 — свободный порт, по умолчанию). Только loopback.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            running: { type: 'boolean', required: true },
            url: { type: 'string', required: true },
            token: { type: 'string', required: true },
            port: { type: 'number', required: true },
            message: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.running
              ? [
                  'Локальный dashboard запущен (read-only, 127.0.0.1).',
                  `URL: ${value.url}`,
                  `порт: ${value.port}`,
                  'Токен уже в URL; после открытия он превращается в HttpOnly-cookie и исчезает из адресной строки.',
                  'Сервер не публикует данные во внешнюю сеть и не принимает изменения.',
                ].join('\n')
              : value.message || 'Dashboard остановлен.',
          },
        ],
      },
      async execute(args) {
        const action = args.action ?? 'start'
        if (action === 'stop') {
          const status = await manager.stop()
          return { ...status, message: 'Dashboard остановлен.' }
        }
        if (action === 'status') {
          const status = manager.status()
          return { ...status, message: status.running ? 'Dashboard работает.' : 'Dashboard не запущен.' }
        }
        try {
          const status = await manager.start(args.port)
          return { ...status, message: 'Dashboard запущен.' }
        } catch (error) {
          throw new FactoryError('UNAVAILABLE', `Не удалось запустить dashboard: ${errorMessage(error)}`)
        }
      },
    }),
  )
}
