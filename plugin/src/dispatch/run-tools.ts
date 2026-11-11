import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { AGENT_ROLES, type AgentRole } from '../agents/types.js'
import { RunService } from './run.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) throw new FactoryError('STORAGE_UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  return runtime
}

export function registerRunTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'factory_run',
    description: 'Создать задачу и сразу передать её роли-исполнителю. По умолчанию async=true: задача RUNNING, DIRECTOR свободен; инструмент возвращает ID. Root-only.',
    parameters: {
      title: { type: 'string', required: true, description: 'Название задачи' },
      description: { type: 'string', description: 'Описание/промпт для исполнителя' },
      role: { type: 'string', enum: AGENT_ROLES, description: 'Роль исполнителя (по умолчанию executor)' },
      async: { type: 'boolean', description: 'Запустить в фоне и сразу вернуть ID (по умолчанию true)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          async: { type: 'boolean', required: true },
          status: { type: 'string', required: true },
          message: { type: 'string', required: true },
          childId: { type: 'string' },
          agentId: { type: 'string' },
          stopReason: { type: 'string' },
          output: { type: 'string' },
          diagnostic: { type: 'string' },
          taskStatus: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.async
          ? `Задача ${value.taskId}: RUNNING\n${value.message}`
          : `Задача ${value.taskId}: ${value.taskStatus}\n${value.output ?? ''}`,
      }],
    },
    async execute(args, exec) {
      const runtime = runtimeOf(getRuntime, getStartupError)
      if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
        throw new FactoryError('FORBIDDEN', 'factory_run доступен только root/DIRECTOR')
      }
      const project = runtime.projectFor(exec)
      const service = new RunService(ctx, runtime)
      const result = await service.run({
        projectId: project.id,
        title: args.title,
        description: args.description,
        role: (args.role ?? 'executor') as AgentRole,
        async: args.async !== false,
      }, exec)
      return result as never
    },
  }))
}
