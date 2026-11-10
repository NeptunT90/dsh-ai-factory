import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
import { ReviewerService } from '../src/reviewer/service.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(): ToolRunContext {
  return {
    callId: 'call_review',
    name: 'factory_review',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: 'ses_parent',
      session: { header: { cwd: 'C:/workspace' } },
    },
  } as unknown as ToolRunContext
}

function fakeContext(service: unknown): Context {
  return {
    get(name: string) {
      return name === 'subagents' ? service : undefined
    },
  } as unknown as Context
}

function activation(result: Promise<unknown>, childId = 'ses_review'): SubagentActivation {
  return {
    childId: childId as never,
    result: result as SubagentActivation['result'],
    dispose: async () => {},
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
  it('completes a task on a structured PASS verdict', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = reviewTask(runtime, projectId)
    let captured: SubagentActivationSpec | undefined
    const fake = {
      startActivation: async (spec: SubagentActivationSpec) => {
        captured = spec
        return activation(
          Promise.resolve({
            output: [],
            structured: { verdict: 'PASS', summary: 'Всё проверено.', issues: [] },
            stopReason: 'completed',
          }),
        )
      },
    } as unknown as SubagentRuntime

    const result = await new ReviewerService(fakeContext(fake), runtime).review({ taskId: task.id }, fakeExec())

    expect(result.verdict).toBe('PASS')
    expect(result.taskStatus).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).status).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).result).toContain('VERDICT: PASS')
    expect(captured?.provider).toBe('spawn')
    expect(captured?.request.outputSchema?.type).toBe('object')
    expect((captured?.request.prompt[0] as { text: string }).text).toContain('Проверить релиз')
    expect((captured?.request.prompt[0] as { text: string }).text).toContain('Независимый')
  })

  it('fails the reviewed task and creates a fix task on FAIL', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = reviewTask(runtime, projectId)
    const fake = {
      startActivation: async () =>
        activation(
          Promise.resolve({
            output: [],
            structured: {
              verdict: 'FAIL',
              summary: 'Тест не запускался.',
              issues: ['Нет доказательства запуска тестов', 'Нет проверки сборки'],
            },
            stopReason: 'completed',
          }),
          'ses_review_fail',
        ),
    } as unknown as SubagentRuntime

    const result = await new ReviewerService(fakeContext(fake), runtime).review({ taskId: task.id }, fakeExec())

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

  it('requires ctx.subagents and leaves the task in REVIEW', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = reviewTask(runtime, projectId)
    await expect(
      new ReviewerService(fakeContext(undefined), runtime).review({ taskId: task.id }, fakeExec()),
    ).rejects.toThrowError(/ctx\.subagents/)
    expect(runtime.tasks.require(task.id).status).toBe('REVIEW')
  })
})
