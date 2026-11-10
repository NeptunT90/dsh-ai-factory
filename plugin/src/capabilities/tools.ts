import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import type { CapabilityCheckItem, CapabilityRecord, CapabilityRequirement, CapabilityScanResult } from './types.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

function assertRoot(runtime: FactoryRuntime, exec: { agent?: { id: string } }): void {
  if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
    throw new FactoryError('FORBIDDEN', 'Capability discovery доступен только root/DIRECTOR')
  }
}

interface ScanView {
  scanId: string
  status: string
  available: number
  unavailable: number
  stale: number
  capabilities: Array<{ id: string; status: string; version: string; path: string }>
}

interface CheckItemView {
  id: string
  status: string
  ready: boolean
  version: string
  minVersion: string
  reason: string
}

function scanView(scan: CapabilityScanResult): ScanView {
  return {
    scanId: scan.scan.id,
    status: scan.scan.status,
    available: scan.capabilities.filter((record) => record.status === 'AVAILABLE').length,
    unavailable: scan.capabilities.filter((record) => record.status === 'UNAVAILABLE').length,
    stale: 0,
    capabilities: scan.capabilities.map((record) => ({
      id: record.capabilityId,
      status: record.stale ? 'STALE' : record.status,
      version: record.version ?? '',
      path: record.path ?? '',
    })),
  }
}

function checkView(item: CapabilityCheckItem): CheckItemView {
  return {
    id: item.id,
    status: item.status,
    ready: item.ready,
    version: item.version ?? '',
    minVersion: item.minVersion ?? '',
    reason: item.reason,
  }
}

export function registerCapabilityTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_capability_scan',
        description:
          'Явно просканировать host capabilities по статическому allowlist. ' +
          'По умолчанию только файловое обнаружение; safe version probes только при capabilityProbeMode=safe. Root-only.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              scanId: { type: 'string', required: true },
              status: { type: 'string', required: true },
              available: { type: 'number', required: true },
              unavailable: { type: 'number', required: true },
              stale: { type: 'number', required: true },
              capabilities: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    version: { type: 'string', required: true },
                    path: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `scan ${value.scanId}: ${value.status}`,
                `available: ${value.available} · unavailable: ${value.unavailable}`,
                ...value.capabilities.map((capability) => `- ${capability.id}: ${capability.status}${capability.version ? ` v${capability.version}` : ''}`),
              ].join('\n'),
            },
          ],
        },
        async execute(_args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const result = await runtime.capabilities.scan('host')
          runtime.auditTool('capability.scanned', null, exec, {
            scanId: result.scan.id,
            available: result.capabilities.filter((record) => record.status === 'AVAILABLE').length,
            unavailable: result.capabilities.filter((record) => record.status === 'UNAVAILABLE').length,
          })
          return scanView(result)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_capability_list',
        description: 'Показать capabilities из кэша. НЕ запускает scan. Root-only.',
        parameters: {
          kind: { type: 'string', description: 'Фильтр по kind' },
          status: { type: 'string', description: 'Фильтр AVAILABLE/UNAVAILABLE/STALE/UNKNOWN' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              capabilities: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    version: { type: 'string', required: true },
                    stale: { type: 'boolean', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.count === 0
                ? 'Кэш capabilities пуст. Нужен явный factory_capability_scan.'
                : value.capabilities.map((capability) => `- ${capability.id}: ${capability.status}${capability.version ? ` v${capability.version}` : ''}${capability.stale ? ' (stale)' : ''}`).join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const capabilities = runtime.capabilities.list({ kind: args.kind, status: args.status })
          return {
            count: capabilities.length,
            capabilities: capabilities.map((record: CapabilityRecord) => ({
              id: record.capabilityId,
              kind: record.kind,
              status: record.stale ? 'STALE' : record.status,
              version: record.version ?? '',
              stale: record.stale,
            })),
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_capability_get',
        description: 'Показать одну capability из кэша. НЕ запускает scan. Root-only.',
        parameters: { id: { type: 'string', required: true, description: 'capability id' } },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              kind: { type: 'string', required: true },
              status: { type: 'string', required: true },
              version: { type: 'string', required: true },
              path: { type: 'string', required: true },
              stale: { type: 'boolean', required: true },
              lastSeenAt: { type: 'number', required: true },
              expiresAt: { type: 'number', required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `${value.id}: ${value.status}${value.version ? ` v${value.version}` : ''}\npath: ${value.path || '—'}\nstale: ${value.stale}`,
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const record = runtime.capabilities.get(args.id)
          if (!record) throw new FactoryError('NOT_FOUND', `Capability ${args.id} отсутствует в кэше; нужен явный scan`, { id: args.id })
          return {
            id: record.capabilityId,
            kind: record.kind,
            status: record.stale ? 'STALE' : record.status,
            version: record.version ?? '',
            path: record.path ?? '',
            stale: record.stale,
            lastSeenAt: record.lastSeenAt,
            expiresAt: record.expiresAt ?? 0,
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_capability_check',
        description:
          'Проверить requirements только по кэшу. Пустой/stale кэш → UNKNOWN/STALE; scan не запускается. Root-only.',
        parameters: {
          requirements: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                minVersion: { type: 'string' },
              },
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ready: { type: 'boolean', required: true },
              checkedAt: { type: 'number', required: true },
              items: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    ready: { type: 'boolean', required: true },
                    version: { type: 'string', required: true },
                    minVersion: { type: 'string', required: true },
                    reason: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `ready: ${value.ready}`,
                ...value.items.map((item) => `- ${item.id}: ${item.status} (${item.reason})${item.version ? ` v${item.version}` : ''}`),
              ].join('\n'),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const requirements = args.requirements as CapabilityRequirement[]
          const result = runtime.capabilities.check(requirements)
          return { ready: result.ready, checkedAt: result.checkedAt, items: result.items.map(checkView) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_capability_refresh',
        description: 'Явно обновить capability cache (полный scan). Не запускается автоматически. Root-only.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              scanId: { type: 'string', required: true },
              status: { type: 'string', required: true },
              available: { type: 'number', required: true },
              unavailable: { type: 'number', required: true },
              stale: { type: 'number', required: true },
              capabilities: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    version: { type: 'string', required: true },
                    path: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            { type: 'text', text: `refresh ${value.scanId}: ${value.status}; available: ${value.available}` },
          ],
        },
        async execute(_args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const result = await runtime.capabilities.scan('host')
          runtime.auditTool('capability.refreshed', null, exec, { scanId: result.scan.id })
          return scanView(result)
        },
      }),
    ),
  )

  return disposers
}
