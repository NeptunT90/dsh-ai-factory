import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError, errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import type { AgentProfile } from '../agents/types.js'
import { ScopedChildRunner, type ChildRunner, type ScopedRunResult } from '../agents/scoped-runner.js'
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

function parseVerdict(text: string): { verdict: ReviewVerdict; summary: string; issues: string[] } | null {
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
    'Твой единственный доступный инструментарий — allowlist профиля; не пытайся вызывать запрещённые инструменты.',
    'Верни ПЕРВОЙ СТРОКОЙ ровно один вердикт: VERDICT: PASS, VERDICT: PASS_WITH_WARNINGS или VERDICT: FAIL.',
    'PASS — критерии выполнены и проверены; PASS_WITH_WARNINGS — работает, но есть некритичные замечания; FAIL — есть блокирующие проблемы.',
    'После вердикта дай summary и список issues строками, начинающимися с "- ".',
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
 * Independent review through a scoped child agent (REVIEWER profile).
 * The reviewer gets its own session and only the profile allowlist, inspects
 * the artifacts and returns a text verdict; the task is completed or failed.
 */
export class ReviewerService {
  private readonly runner: ChildRunner

  constructor(
    ctx: Context,
    private readonly runtime: FactoryRuntime,
    runner?: ChildRunner,
  ) {
    this.runner = runner ?? new ScopedChildRunner(ctx, runtime)
  }

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
    if (reviewer.allowedTools.length === 0) {
      throw new FactoryError('FORBIDDEN', 'Профиль REVIEWER не имеет allowedTools')
    }
    const parent = exec.agent
    if (!parent) throw new FactoryError('UNAVAILABLE', 'factory_review требует вызывающего агента')
    const project = runtime.projects.require(task.projectId)
    const routePlan = runtime.models.plan(reviewer, parent)
    if (routePlan.attempts.length === 0) {
      throw new FactoryError('UNAVAILABLE', 'Нет model route для REVIEWER')
    }
    runtime.audit.record({
      event: 'model.route',
      level: 'info',
      actor: parent.id,
      projectId: task.projectId,
      sessionId: parent.id,
      data: {
        taskId: task.id,
        reviewerAgentId: reviewer.id,
        routes: routePlan.attempts.map((route) => ({ provider: route.provider, model: route.model, source: route.source })),
      },
    })
    runtime.audit.record({
      event: 'review.started',
      level: 'info',
      actor: parent.id,
      projectId: task.projectId,
      sessionId: parent.id,
      data: { taskId: task.id, reviewerAgentId: reviewer.id, allowedTools: reviewer.allowedTools.length },
    })

    try {
      let result: ScopedRunResult | undefined
      for (let attempt = 0; attempt < routePlan.attempts.length; attempt += 1) {
        const route = routePlan.attempts[attempt]!
        result = await this.runner.run({
          parent,
          cwd: project.rootPath,
          prompt: composePrompt(runtime, task, reviewer, input.instructions),
          profile: reviewer,
          signal: exec.signal,
          label: `review: ${task.title}`,
          timeoutMs: task.timeoutMs && task.timeoutMs > 0 ? task.timeoutMs : undefined,
          agentOptions: route.options,
        })
        if (result.stopReason === 'completed') break
        if (attempt + 1 < routePlan.attempts.length) {
          runtime.audit.record({
            event: 'model.fallback',
            level: 'warn',
            actor: parent.id,
            projectId: task.projectId,
            sessionId: parent.id,
            data: {
              taskId: task.id,
              from: `${route.provider}/${route.model}`,
              to: `${routePlan.attempts[attempt + 1]!.provider}/${routePlan.attempts[attempt + 1]!.model}`,
              diagnostic: result.diagnostic.slice(0, 300),
            },
          })
        }
      }
      if (!result || result.stopReason !== 'completed') {
        throw new FactoryError(
          'UNAVAILABLE',
          `REVIEWER остановлен: ${result?.stopReason ?? 'no attempt'}${result?.diagnostic ? ` (${result.diagnostic})` : ''}`,
        )
      }
      const parsed = parseVerdict(result.output) ?? {
        verdict: 'FAIL' as const,
        summary: 'REVIEWER не вернул строку VERDICT.',
        issues: ['verdict missing'],
      }
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
          data: { taskId: task.id, childId: result.childId, verdict: parsed.verdict },
        })
        return {
          taskId: task.id,
          childId: result.childId,
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
        metadata: { fixFor: task.id, reviewVerdict: parsed.verdict, reviewerChildId: result.childId },
        createdBy: parent.id,
      })
      runtime.audit.record({
        event: 'review.failed',
        level: 'warn',
        actor: parent.id,
        projectId: task.projectId,
        sessionId: parent.id,
        data: { taskId: task.id, childId: result.childId, verdict: parsed.verdict, fixTaskId: fix.id },
      })
      return {
        taskId: task.id,
        childId: result.childId,
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
    }
  }
}
