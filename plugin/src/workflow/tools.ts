import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { WorkflowService } from './service.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

export function registerWorkflowTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_workflow_run',
      description:
        'Автономный ограниченный цикл: dispatch исполнителя (review=true) → независимый REVIEWER → fix-задача → повтор. ' +
        'PASS/PASS_WITH_WARNINGS завершает цикл; FAIL создаёт fix-задачу, которая запускается следующим циклом. ' +
        'Ограничение maxCycles 1–5. Все дочерние агенты реальные, через ctx.subagents; ошибка ребёнка останавливает цикл. ' +
        'Возвращает статус PASSED/FAILED/EXHAUSTED/ERROR и историю циклов.',
      parameters: {
        taskId: { type: 'string', required: true, description: 'ID READY/REVIEW-задачи' },
        maxCycles: { type: 'number', description: 'Максимум циклов dispatch+review (1–5, по умолчанию 3)' },
        reviewerAgentId: { type: 'string', description: 'Профиль REVIEWER' },
        instructions: { type: 'string', description: 'Дополнительные критерии ревью' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            finalTaskId: { type: 'string', required: true },
            fixTaskId: { type: 'string', required: true },
            message: { type: 'string', required: true },
            cycles: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  cycle: { type: 'number', required: true },
                  taskId: { type: 'string', required: true },
                  dispatchStatus: { type: 'string', required: true },
                  verdict: { type: 'string', required: true },
                  reviewerChildId: { type: 'string', required: true },
                  fixTaskId: { type: 'string', required: true },
                  taskStatus: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `workflow: ${value.status}`,
              value.message,
              ...value.cycles.map(
                (cycle) =>
                  `цикл ${cycle.cycle}: ${cycle.taskId} → ${cycle.verdict} (${cycle.taskStatus})` +
                  (cycle.fixTaskId ? `, fix ${cycle.fixTaskId}` : ''),
              ),
              value.fixTaskId ? `последняя fix-задача: ${value.fixTaskId}` : '',
            ]
              .filter((line) => line !== '')
              .join('\n'),
          },
        ],
      },
      timeoutMs: 120 * 60_000,
      async execute(args, exec) {
        const runtime = runtimeOf(getRuntime, getStartupError)
        return new WorkflowService(ctx, runtime).run(
          {
            taskId: args.taskId,
            ...(args.maxCycles ? { maxCycles: args.maxCycles } : {}),
            ...(args.reviewerAgentId ? { reviewerAgentId: args.reviewerAgentId } : {}),
            ...(args.instructions ? { instructions: args.instructions } : {}),
          },
          exec,
        )
      },
    }),
  )
}
