import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ChildRunner, ScopedRunInput, ScopedRunResult } from '../src/agents/scoped-runner.js'
import { ReviewerService } from '../src/reviewer/service.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(cwd = 'C:/workspace'): ToolRunContext {
  return {
    callId: 'call_review',
    name: 'factory_review',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: 'ses_parent',
      options: { provider: 'fake', model: 'fake-model' },
      session: { header: { cwd } },
    },
  } as unknown as ToolRunContext
}

function fakeContext(): Context {
  return {
    get() {
      return undefined
    },
  } as unknown as Context
}

function runner(result: ScopedRunResult, captured?: { input?: ScopedRunInput }): ChildRunner {
  return {
    async run(input) {
      if (captured) captured.input = input
      return result
    },
  }
}

function reviewTask(runtime: ReturnType<typeof createTestRuntime>['runtime'], projectId: string) {
  const developer = runtime.agents.findByRole('developer')!
  const task = runtime.tasks.create({
    projectId,
    title: 'Проверить релиз',
    description: 'Собрать и проверить артефакт.',
    assignedAgentId: developer.id,
  })
  runtime.tasks.claim(task.id, { owner: 'executor' })
  return runtime.tasks.submitForReview(task.id, 'executor', 'Артефакт собран, тесты прошли.')
}

describe('ReviewerService', () => {
  it('completes a task on PASS and preserves the executor result', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = reviewTask(runtime, projectId)
    const captured: { input?: ScopedRunInput } = {}
    const service = new ReviewerService(
      fakeContext(),
      runtime,
      runner({ childId: 'ses_review', output: 'VERDICT: PASS\nВсё проверено.', stopReason: 'completed', diagnostic: '' }, captured),
    )

    const result = await service.review({ taskId: task.id }, fakeExec(runtime.projects.require(projectId).rootPath))

    expect(result.verdict).toBe('PASS')
    expect(result.taskStatus).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).status).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).result).toContain('Артефакт собран')
    expect(runtime.tasks.require(task.id).result).toContain('VERDICT: PASS')
    expect(captured.input?.profile.role).toBe('reviewer')
    expect(captured.input?.profile.allowedTools).not.toContain('factory_dispatch')
    expect(captured.input?.profile.allowedTools).not.toContain('factory_review')
    expect(captured.input?.prompt).toContain('Проверить релиз')
    expect(captured.input?.prompt).toContain('VERDICT')
  })

  it('fails the reviewed task and creates a fix task on FAIL', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = reviewTask(runtime, projectId)
    const service = new ReviewerService(
      fakeContext(),
      runtime,
      runner({
        childId: 'ses_review_fail',
        output: 'VERDICT: FAIL\nТест не запускался.\n- Нет доказательства запуска тестов\n- Нет проверки сборки',
        stopReason: 'completed',
        diagnostic: '',
      }),
    )

    const result = await service.review({ taskId: task.id }, fakeExec(runtime.projects.require(projectId).rootPath))

    expect(result.verdict).toBe('FAIL')
    expect(result.taskStatus).toBe('FAILED')
    expect(result.fixTaskId).not.toBe('')
    expect(runtime.tasks.require(task.id).status).toBe('FAILED')
    const fix = runtime.tasks.require(result.fixTaskId)
    expect(fix.status).toBe('READY')
    expect(fix.title).toContain('Исправить')
    expect(fix.description).toContain('Нет доказательства')
    expect((fix.metadata as Record<string, unknown>).fixFor).toBe(task.id)
  })

  it('requires ctx.agents and leaves the task in REVIEW', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = reviewTask(runtime, projectId)
    await expect(
      new ReviewerService(fakeContext(), runtime).review({ taskId: task.id }, fakeExec(runtime.projects.require(projectId).rootPath)),
    ).rejects.toThrowError(/ctx\.agents/)
    expect(runtime.tasks.require(task.id).status).toBe('REVIEW')
  })
})
