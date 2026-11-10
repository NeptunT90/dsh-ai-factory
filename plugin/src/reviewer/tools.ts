import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { ReviewerService } from './service.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

export function registerReviewerTool(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'factory_review',
      description:
        'Провести независимое ревью задачи в статусе REVIEW реальным дочерним агентом REVIEWER с allowlist профиля. ' +
        'REVIEWER получает собственный контекст, проверяет артефакты/тесты и возвращает verdict ' +
        '(PASS/PASS_WITH_WARNINGS/FAIL). PASS закрывает задачу; FAIL переводит её в FAILED и создаёт задачу на исправление. ' +
        'Требует ctx.agents; дочерний tool allowlist enforced.',
      parameters: {
        taskId: { type: 'string', required: true, description: 'ID задачи в статусе REVIEW' },
        reviewerAgentId: { type: 'string', description: 'Профиль REVIEWER; по умолчанию первый reviewer' },
        instructions: { type: 'string', description: 'Дополнительные критерии ревью' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            taskId: { type: 'string', required: true },
            childId: { type: 'string', required: true },
            reviewerAgentId: { type: 'string', required: true },
            verdict: { type: 'string', required: true },
            summary: { type: 'string', required: true },
            issues: { type: 'array', items: { type: 'string' }, required: true },
            taskStatus: { type: 'string', required: true },
            fixTaskId: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `REVIEW ${value.taskId}: ${value.verdict}`,
              value.summary,
              value.issues.length > 0 ? `Замечания:\n${value.issues.map((issue) => `- ${issue}`).join('\n')}` : '',
              `статус задачи: ${value.taskStatus}`,
              value.fixTaskId ? `создана задача на исправление: ${value.fixTaskId}` : '',
              `reviewer child: ${value.childId}`,
            ]
              .filter((line) => line !== '')
              .join('\n'),
          },
        ],
      },
      timeoutMs: 30 * 60_000,
      async execute(args, exec) {
        const runtime = runtimeOf(getRuntime, getStartupError)
        const reviewer = new ReviewerService(ctx, runtime)
        return reviewer.review(
          {
            taskId: args.taskId,
            ...(args.reviewerAgentId ? { reviewerAgentId: args.reviewerAgentId } : {}),
            ...(args.instructions ? { instructions: args.instructions } : {}),
          },
          exec,
        )
      },
    }),
  )
}
