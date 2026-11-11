import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { ImprovementService, type ImprovementCandidate } from './service.js'

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  return runtime
}

function rootOnly(runtime: FactoryRuntime, exec: { agent?: { id: string } }): void {
  if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
    throw new FactoryError('FORBIDDEN', 'Self-Improvement доступен только root')
  }
}

function view(candidate: ImprovementCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    sourceTaskId: candidate.sourceTaskId,
    status: candidate.status,
    skillId: candidate.skillId ?? '',
    reviewerVerdict: candidate.reviewerVerdict ?? '',
    reviewerNotes: candidate.reviewerNotes ?? '',
  }
}

export function registerImprovementTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(ctx.tools.register(defineTool({
    name: 'factory_improve_task',
    description: 'Создать DRAFT-кандидата навыка из COMPLETED-задачи с attempts >= 3. Root-only; файл не пишется.',
    parameters: { taskId: { type: 'string', required: true, description: 'id завершённой задачи' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          sourceTaskId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          skillId: { type: 'string', required: true },
          reviewerVerdict: { type: 'string', required: true },
          reviewerNotes: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Кандидат ${value.id}: ${value.status}, skill ${value.skillId}` }],
    },
    async execute(args, exec) {
      const runtime = runtimeOf(getRuntime, getStartupError)
      rootOnly(runtime, exec)
      const project = runtime.projectFor(exec)
      const candidate = new ImprovementService(runtime).create(args.taskId, project.id)
      runtime.auditTool('improvement.created', project, exec, { candidateId: candidate.id, taskId: args.taskId })
      return view(candidate) as never
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'factory_improve_list',
    description: 'Список кандидатов Self-Improvement текущего проекта.',
    parameters: { limit: { type: 'number', description: '1..200, по умолчанию 100' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          count: { type: 'number', required: true },
          candidates: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                sourceTaskId: { type: 'string', required: true },
                status: { type: 'string', required: true },
                skillId: { type: 'string', required: true },
                reviewerVerdict: { type: 'string', required: true },
                reviewerNotes: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.count === 0 ? 'Кандидатов нет.' : value.candidates.map((c) => `- ${c.id}: ${c.status} → ${c.skillId}`).join('\n') }],
    },
    async execute(args, exec) {
      const runtime = runtimeOf(getRuntime, getStartupError)
      const project = runtime.projectFor(exec)
      const candidates = new ImprovementService(runtime).list(project.id, args.limit)
      return { count: candidates.length, candidates: candidates.map((candidate) => view(candidate)) as never }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'factory_improve_apply',
    description: 'Проверить DRAFT как REVIEWER и записать .skills/<id>.md только при PASS. Root-only.',
    parameters: { candidateId: { type: 'string', required: true, description: 'id кандидата' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          candidateId: { type: 'string', required: true },
          skillId: { type: 'string', required: true },
          path: { type: 'string', required: true },
          status: { type: 'string', required: true },
          reviewerVerdict: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Записан ${value.path} (${value.candidateId})` }],
    },
    async execute(args, exec) {
      const runtime = runtimeOf(getRuntime, getStartupError)
      rootOnly(runtime, exec)
      const project = runtime.projectFor(exec)
      const result = new ImprovementService(runtime).apply(project.id, args.candidateId)
      runtime.auditTool('improvement.applied', project, exec, { candidateId: result.candidate.id, skillId: result.skillId, path: result.path })
      return {
        candidateId: result.candidate.id,
        skillId: result.skillId,
        path: result.path,
        status: result.candidate.status,
        reviewerVerdict: result.candidate.reviewerVerdict ?? '',
      }
    },
  })))

  return disposers
}
