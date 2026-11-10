import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import { asJsonValue, type JsonValue } from '../core/json.js'
import type { FactoryRuntime } from '../runtime.js'
import { TOOL_HEALTH_STATUSES, type ToolHealthStatus } from './types.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  if (!runtime.health) throw new FactoryError('UNAVAILABLE', 'Tool Health Service не инициализирован')
  return runtime
}

function assertRoot(runtime: FactoryRuntime, exec: { agent?: { id: string } }): void {
  if (!exec.agent) throw new FactoryError('FORBIDDEN', 'tool health requires a calling agent')
  if (runtime.hasChildAllowlist(exec.agent.id)) {
    throw new FactoryError('FORBIDDEN', 'tool health is root-only; child allowlists cannot run it')
  }
}

interface SummaryView {
  readonly toolName: string
  readonly risk: string
  readonly status: string
  readonly source: string
  readonly lastCheckedAt?: number
  readonly latencyMs?: number
  readonly errorKind?: string
  readonly errorMessage?: string
  readonly dependenciesChecked: boolean
  readonly actions: readonly {
    action: string
    risk: string
    status: string
    latencyMs?: number
    errorKind?: string
  }[]
}

function renderSummary(summary: SummaryView): string {
  const line = [
    `${summary.toolName}: ${summary.status}`,
    `risk=${summary.risk}`,
    `source=${summary.source}`,
    summary.lastCheckedAt === null || summary.lastCheckedAt === undefined
      ? 'checked=—'
      : `checked=${new Date(summary.lastCheckedAt).toISOString()}`,
    summary.latencyMs === null || summary.latencyMs === undefined ? 'latency=—' : `${summary.latencyMs}ms`,
    summary.errorKind ? `error=${summary.errorKind}` : '',
  ]
    .filter((part) => part !== '')
    .join(' · ')
  return `${line}\n  actions: ${summary.actions.map((action) => `${action.action}=${action.status}`).join(', ')}`
}

export function registerHealthTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_tool_health',
        description:
          'Показать health factory_* инструментов: статус, риск, источник, время проверки, latency и ошибку. ' +
          'Host-tools DSH (read/write/pwsh/browser) не входят в этот health и не получают статусов.',
        parameters: {
          tool: { type: 'string', description: 'Фильтр по factory-инструменту' },
          action: { type: 'string', description: 'Фильтр по действию (status/push/run/…)' },
          status: { type: 'string', enum: TOOL_HEALTH_STATUSES, description: 'Фильтр по статусу' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              scope: { type: 'string', required: true },
              toolCount: { type: 'number', required: true },
              tools: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    toolName: { type: 'string', required: true },
                    risk: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    lastCheckedAt: { type: 'number',  },
                    latencyMs: { type: 'number',  },
                    errorKind: { type: 'string',  },
                    errorMessage: { type: 'string',  },
                    dependenciesChecked: { type: 'boolean', required: true },
                    actions: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          action: { type: 'string', required: true },
                          risk: { type: 'string', required: true },
                          status: { type: 'string', required: true },
                          latencyMs: { type: 'number',  },
                          errorKind: { type: 'string',  },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `scope: ${value.scope} · tools: ${value.toolCount}`,
                ...(value.tools as unknown as SummaryView[]).map(renderSummary),
              ].join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const status = args.status as ToolHealthStatus | undefined
          const summaries = runtime.health!.summaries({
            ...(args.tool === undefined ? {} : { tool: args.tool }),
            ...(args.action === undefined ? {} : { action: args.action }),
            ...(status === undefined ? {} : { status }),
          })
          return {
            scope: 'factory_only',
            toolCount: summaries.length,
            tools: summaries.map((summary) => ({
              toolName: summary.toolName,
              risk: summary.risk,
              status: summary.status,
              source: summary.source,
              ...(summary.lastCheckedAt === null ? {} : { lastCheckedAt: summary.lastCheckedAt }),
              ...(summary.latencyMs === null ? {} : { latencyMs: summary.latencyMs }),
              ...(summary.errorKind === null ? {} : { errorKind: summary.errorKind }),
              ...(summary.errorMessage === null ? {} : { errorMessage: summary.errorMessage }),
              dependenciesChecked: summary.dependenciesChecked,
              actions: summary.actions.map((action) => ({
                action: action.action,
                risk: action.risk,
                status: action.status,
                ...(action.latencyMs === null ? {} : { latencyMs: action.latencyMs }),
                ...(action.errorKind === null ? {} : { errorKind: action.errorKind }),
              })),
            })) as any,
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_tool_health_check',
        description:
          'Проверить health factory_* инструментов. R0 — безопасный probe через ctx.tools pipeline; ' +
          'R1 — только schema/registration (REGISTERED, зависимости не проверяются); ' +
          'R2 — NOT_TESTABLE без выполнения. Host-tools не проверяются.',
        parameters: {
          tool: { type: 'string', description: 'Проверить один factory-инструмент' },
          action: { type: 'string', description: 'Проверить одно действие mixed-инструмента' },
          force: { type: 'boolean', description: 'Игнорировать TTL 10 минут' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              checked: { type: 'number', required: true },
              healthy: { type: 'number', required: true },
              degraded: { type: 'number', required: true },
              unavailable: { type: 'number', required: true },
              registered: { type: 'number', required: true },
              notTestable: { type: 'number', required: true },
              unknown: { type: 'number', required: true },
              tools: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `checked: ${value.checked}`,
                `HEALTHY: ${value.healthy} · DEGRADED: ${value.degraded} · UNAVAILABLE: ${value.unavailable}`,
                `REGISTERED: ${value.registered} · NOT_TESTABLE: ${value.notTestable} · UNKNOWN: ${value.unknown}`,
                ...(value.tools as Array<{ toolName: string; status: string; risk: string }>).map(
                  (tool) => `- ${tool.toolName}: ${tool.status} (${tool.risk})`,
                ),
              ].join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const records = await runtime.health!.check(
            {
              ...(args.tool === undefined ? {} : { tool: args.tool }),
              ...(args.action === undefined ? {} : { action: args.action }),
              force: args.force === true,
            },
            exec,
          )
          const summaries = runtime.health!.summaries({
            ...(args.tool === undefined ? {} : { tool: args.tool }),
            ...(args.action === undefined ? {} : { action: args.action }),
          })
          const count = (status: string): number => summaries.filter((summary) => summary.status === status).length
          return {
            checked: records.length,
            healthy: count('HEALTHY'),
            degraded: count('DEGRADED'),
            unavailable: count('UNAVAILABLE'),
            registered: count('REGISTERED'),
            notTestable: count('NOT_TESTABLE'),
            unknown: count('UNKNOWN'),
            tools: summaries.map((summary) => ({
              toolName: summary.toolName,
              risk: summary.risk,
              status: summary.status,
              source: summary.source,
              dependenciesChecked: summary.dependenciesChecked,
              actions: summary.actions.map((action) => ({
                action: action.action,
                risk: action.risk,
                status: action.status,
                ...(action.latencyMs === null ? {} : { latencyMs: action.latencyMs }),
                ...(action.errorKind === null ? {} : { errorKind: action.errorKind }),
                details: action.details,
              })),
            })) as unknown as JsonValue[],
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_tool_health_history',
        description: 'История проверок factory_* инструментов. Host-tools не входят в health.',
        parameters: {
          tool: { type: 'string', description: 'Фильтр по factory-инструменту' },
          action: { type: 'string', description: 'Фильтр по действию' },
          limit: { type: 'number', description: 'Максимум записей (1..200)' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              entries: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.count === 0
                ? 'История health пуста.'
                : value.entries.map((entry) => `- ${JSON.stringify(entry)}`).join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const entries = runtime.health!.history(args.tool, args.action, args.limit)
          return { count: entries.length, entries: entries as unknown as JsonValue[] }
        },
      }),
    ),
  )

  return disposers
}
