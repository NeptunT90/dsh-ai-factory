import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { BackupService, type BackupRestoreTestResult, type BackupVerifyResult } from './service.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  return runtime
}

function assertRoot(runtime: FactoryRuntime, exec: { agent?: { id: string } }): void {
  if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
    throw new FactoryError('FORBIDDEN', 'Backup tools доступны только root/DIRECTOR')
  }
}

interface VerifyView {
  ok: boolean
  archive: string
  archiveBytes: number
  pluginVersion: string
  schemaVersion: number
  createdAt: string
  tables: Array<{ name: string; rows: number; sha256: string }>
  databaseSha256: string
  integrity: string
  errors: string[]
  temporaryRemoved: boolean
}

interface RestoreView {
  ok: boolean
  archive: string
  agents: number
  tasks: number
  memory: number
  schemaVersion: number
  tables: number
  errors: string[]
  temporaryRemoved: boolean
}

function verifyView(value: BackupVerifyResult): VerifyView {
  return {
    ok: value.ok,
    archive: value.archive,
    archiveBytes: value.archiveBytes,
    pluginVersion: value.pluginVersion,
    schemaVersion: value.schemaVersion,
    createdAt: value.createdAt,
    tables: value.tables.map((table) => ({ name: table.name, rows: table.rows, sha256: table.sha256 })),
    databaseSha256: value.databaseSha256,
    integrity: value.integrity,
    errors: [...value.errors],
    temporaryRemoved: value.temporaryRemoved,
  }
}

function restoreView(value: BackupRestoreTestResult): RestoreView {
  return {
    ok: value.ok,
    archive: value.archive,
    agents: value.agents,
    tasks: value.tasks,
    memory: value.memory,
    schemaVersion: value.schemaVersion,
    tables: value.tables,
    errors: [...value.errors],
    temporaryRemoved: value.temporaryRemoved,
  }
}

export function registerBackupTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_backup_verify',
        description:
          'Проверить локальный .tar.gz backup: gzip magic, manifest, таблицы и SQLite quick_check. Root-only.',
        parameters: {
          archive: { type: 'string', required: true, description: 'путь к .tar.gz в <project>/backups или <dataDir>/backups' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              archive: { type: 'string', required: true },
              archiveBytes: { type: 'number', required: true },
              pluginVersion: { type: 'string', required: true },
              schemaVersion: { type: 'number', required: true },
              createdAt: { type: 'string', required: true },
              tables: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true },
                    rows: { type: 'number', required: true },
                    sha256: { type: 'string', required: true },
                  },
                },
              },
              databaseSha256: { type: 'string', required: true },
              integrity: { type: 'string', required: true },
              errors: { type: 'array', items: { type: 'string' }, required: true },
              temporaryRemoved: { type: 'boolean', required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.ok
                ? `backup OK · ${value.tables.length} tables · schema ${value.schemaVersion} · plugin ${value.pluginVersion}`
                : `backup INVALID: ${value.errors.join('; ')}`,
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const result = await new BackupService(runtime).verify(args.archive, exec)
          return verifyView(result)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_backup_restore_test',
        description:
          'Восстановить копию backup во временную папку, проверить schema и вернуть counts агентов/задач/памяти. Root-only.',
        parameters: {
          archive: { type: 'string', required: true, description: 'путь к .tar.gz в <project>/backups или <dataDir>/backups' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              archive: { type: 'string', required: true },
              agents: { type: 'number', required: true },
              tasks: { type: 'number', required: true },
              memory: { type: 'number', required: true },
              schemaVersion: { type: 'number', required: true },
              tables: { type: 'number', required: true },
              errors: { type: 'array', items: { type: 'string' }, required: true },
              temporaryRemoved: { type: 'boolean', required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.ok
                ? `restore test OK · agents ${value.agents} · tasks ${value.tasks} · memory ${value.memory} · schema ${value.schemaVersion}`
                : `restore test FAILED: ${value.errors.join('; ')}`,
            },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertRoot(runtime, exec)
          const result = await new BackupService(runtime).restoreTest(args.archive, exec)
          runtime.auditTool('backup.restore_test', null, exec, {
            archive: result.archive,
            ok: result.ok,
            agents: result.agents,
            tasks: result.tasks,
            memory: result.memory,
            temporaryRemoved: result.temporaryRemoved,
          })
          return restoreView(result)
        },
      }),
    ),
  )

  return disposers
}
