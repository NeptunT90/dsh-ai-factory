import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentActivation, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError, errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import type { AgentProfile } from '../agents/types.js'
import type { TaskRecord } from '../tasks/types.js'

export const REVIEW_VERDICTS = ['PASS', 'PASS_WITH_WARNINGS', 'FAIL'] as const
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]

export interface ReviewInput {
  readonly taskId: string
  readonly reviewerAgentId?: string
  readonly instructions?: string
}

export interface ReviewResult {
  readonly taskId: string
  readonly childId: string
  readonly reviewerAgentId: string
  readonly verdict: ReviewVerdict
  readonly summary: string
  readonly issues: string[]
  readonly taskStatus: string
  readonly fixTaskId: string
}

const REVIEW_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: [...REVIEW_VERDICTS] },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'issues'],
}

function textFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter((text) => text !== '')
    .join('\n')
}

function modelOptions(agent: AgentProfile): AgentOptions | undefined {
  if (!agent.modelProvider || !agent.model) return undefined
  return {
    provider: agent.modelProvider,
    model: agent.model,
    ...(agent.reasoningEffort
      ? { reasoningEffort: agent.reasoningEffort as AgentOptions['reasoningEffort'] }
      : {}),
  }
}

function parseVerdict(value: unknown): { verdict: ReviewVerdict; summary: string; issues: string[] } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.verdict !== 'PASS' && record.verdict !== 'PASS_WITH_WARNINGS' && record.verdict !== 'FAIL') return null
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  const issues = Array.isArray(record.issues)
    ? record.issues.filter((issue): issue is string => typeof issue === 'string').slice(0, 50)
    : []
  return { verdict: record.verdict, summary: summary || 'Вердикт без summary.', issues }
}

function parseTextVerdict(text: string): { verdict: ReviewVerdict; summary: string; issues: string[] } | null {
  const match = /\bVERDICT\s*:\s*(PASS_WITH_WARNINGS|PASS|FAIL)\b/i.exec(text)
  if (!match?.[1]) return null
  const verdict = match[1].toUpperCase() as ReviewVerdict
  const issues = text
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 50)
  return { verdict, summary: text.trim().slice(0, 8000), issues }
}

function composePrompt(runtime: FactoryRuntime, task: TaskRecord, reviewer: AgentProfile, extra?: string): string {
  const project = runtime.projects.require(task.projectId)
  return [
    `Ты ${reviewer.name} (${reviewer.role}) — ${reviewer.title}.`,
    reviewer.systemInstruction,
    '',
    'Ты независимый REVIEWER. Не доверяй отчёту исполнителя: проверяй фактические артефакты, код, тесты и сборку.',
    'Верни результат только через structured_output с полями: verdict (PASS|PASS_WITH_WARNINGS|FAIL), summary, issues.',
    'PASS — критерии выполнены и проверены; PASS_WITH_WARNINGS — работает, но есть некритичные замечания; FAIL — есть блокирующие проблемы.',
    '',
    `Задача: ${task.title}`,
    `ID: ${task.id}`,
    `Цель: ${task.goal || task.title}`,
    `Описание: ${task.description || '(нет)'}`,
    `Проект: ${project.name} (${project.rootPath})`,
    `Результат исполнителя: ${task.result || '(не записан)'}`,
    `Попытки исполнителя: ${task.attempts}/${task.maxAttempts}`,
    extra?.trim() ? `Дополнительные указания: ${extra.trim()}` : '',
    '',
    'Проверь: соответствие цели, работоспособность, тесты/сборку, безопасность, отсутствие регрессий. Укажи конкретные evidence.',
  ]
    .filter((part) => part !== '')
    .join('\n')
}

/**
 * Independent review through a real child agent (REVIEWER profile).
 * The reviewer gets its own session and host tools, inspects the artifacts and
 * returns a structured verdict; the task is completed or failed accordingly.
 */
export class ReviewerService {
  constructor(
    private readonly ctx: Context,
    private readonly runtime: FactoryRuntime,
  ) {}

  async review(input: ReviewInput, exec: ToolRunContext): Promise<ReviewResult> {
    const runtime = this.runtime
    const task = runtime.tasks.require(input.taskId)
    if (task.status !== 'REVIEW') {
      throw new FactoryError('CONFLICT', `factory_review требует задачу в REVIEW, сейчас ${task.status}`)
    }
    const reviewer = input.reviewerAgentId
      ? runtime.agents.require(input.reviewerAgentId)
      : runtime.agents.findByRole('reviewer')
    if (!reviewer) throw new FactoryError('NOT_FOUND', 'Профиль REVIEWER не найден')
    if (!reviewer.enabled) throw new FactoryError('FORBIDDEN', 'Профиль REVIEWER отключён')
    const parent = exec.agent
    if (!parent) throw new FactoryError('UNAVAILABLE', 'factory_review требует вызывающего агента')
    const subagents = this.ctx.get('subagents') as SubagentRuntime | undefined
    if (!subagents) {
      throw new FactoryError('UNAVAILABLE', 'ctx.subagents недоступен; нужен @deepseek-ai/dsh-subagent + spawn')
    }
    const project = runtime.projects.require(task.projectId)
    runtime.audit.record({
      event: 'review.started',
      level: 'info',
      actor: parent.id,
      projectId: task.projectId,
      sessionId: parent.id,
      data: { taskId: task.id, reviewerAgentId: reviewer.id },
    })

    let activation: SubagentActivation | undefined
    try {
      activation = await subagents.startActivation({
        provider: 'spawn',
        label: `review: ${task.title}`.slice(0, 80),
        request: {
          prompt: [{ type: 'text', text: composePrompt(runtime, task, reviewer, input.instructions) }],
          parent,
          cwd: project.rootPath,
          maxDepth: 1,
          outputSchema: REVIEW_SCHEMA,
          ...(modelOptions(reviewer) === undefined ? {} : { agentOptions: modelOptions(reviewer) }),
        },
        signal: exec.signal,
        delivery: 'caller',
      })
      const result = await activation.result
      if (result.stopReason !== 'completed') {
        throw new FactoryError(
          'UNAVAILABLE',
          `REVIEWER остановлен: ${result.stopReason}${result.diagnostic ? ` (${result.diagnostic})` : ''}`,
        )
      }
      const parsed =
        parseVerdict(result.structured) ??
        parseTextVerdict(textFromBlocks(result.output)) ??
        ({ verdict: 'FAIL', summary: 'REVIEWER не вернул структурированный вердикт.', issues: ['verdict missing'] } as const)
      const reviewText = [
        `VERDICT: ${parsed.verdict}`,
        parsed.summary,
        parsed.issues.length > 0 ? `Issues:\n${parsed.issues.map((issue) => `- ${issue}`).join('\n')}` : '',
      ]
        .filter((line) => line !== '')
        .join('\n')

      if (parsed.verdict === 'PASS' || parsed.verdict === 'PASS_WITH_WARNINGS') {
        const priorResult = task.result?.trim() ?? ''
        const completionText = priorResult ? `${priorResult}\n\n--- REVIEW ---\n${reviewText}` : reviewText
        const completed = runtime.tasks.complete(task.id, parent.id, completionText)
        runtime.audit.record({
          event: 'review.completed',
          level: 'info',
          actor: parent.id,
          projectId: task.projectId,
          sessionId: parent.id,
          data: { taskId: task.id, childId: activation.childId, verdict: parsed.verdict },
        })
        return {
          taskId: task.id,
          childId: activation.childId,
          reviewerAgentId: reviewer.id,
          verdict: parsed.verdict,
          summary: parsed.summary,
          issues: parsed.issues,
          taskStatus: completed.status,
          fixTaskId: '',
        }
      }

      const failed = runtime.tasks.fail(task.id, parent.id, reviewText, false)
      const originalAgent = task.assignedAgentId ? runtime.agents.get(task.assignedAgentId) : undefined
      const fixAgent = originalAgent?.enabled ? originalAgent.id : runtime.agents.findByRole('developer')?.id
      const fix = runtime.tasks.create({
        projectId: task.projectId,
        parentId: task.parentId,
        title: `Исправить: ${task.title}`.slice(0, 300),
        description: [parsed.summary, ...parsed.issues.map((issue) => `- ${issue}`)].join('\n'),
        goal: `Устранить замечания REVIEWER по задаче ${task.id}`,
        assignedAgentId: fixAgent ?? null,
        assignedRole: task.assignedRole ?? 'developer',
        priority: Math.min(100, task.priority + 10),
        maxAttempts: task.maxAttempts,
        timeoutMs: task.timeoutMs,
        metadata: { fixFor: task.id, reviewVerdict: parsed.verdict, reviewerChildId: activation.childId },
        createdBy: parent.id,
      })
      runtime.audit.record({
        event: 'review.failed',
        level: 'warn',
        actor: parent.id,
        projectId: task.projectId,
        sessionId: parent.id,
        data: { taskId: task.id, childId: activation.childId, verdict: parsed.verdict, fixTaskId: fix.id },
      })
      return {
        taskId: task.id,
        childId: activation.childId,
        reviewerAgentId: reviewer.id,
        verdict: parsed.verdict,
        summary: parsed.summary,
        issues: parsed.issues,
        taskStatus: failed.status,
        fixTaskId: fix.id,
      }
    } catch (error) {
      runtime.audit.record({
        event: 'review.error',
        level: 'error',
        actor: parent.id,
        projectId: task.projectId,
        sessionId: parent.id,
        data: { taskId: task.id, error: errorMessage(error).slice(0, 500) },
      })
      throw error
    } finally {
      if (activation) {
        try {
          await activation.dispose()
        } catch {
          // result remains authoritative
        }
      }
    }
  }
}
