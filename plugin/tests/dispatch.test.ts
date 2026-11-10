import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ChildRunner, ScopedRunInput, ScopedRunResult } from '../src/agents/scoped-runner.js'
import { DispatchService } from '../src/dispatch/service.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(): ToolRunContext {
  return {
    callId: 'call_dispatch',
    name: 'factory_dispatch',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: 'ses_parent',
      session: { header: { cwd: 'C:/workspace' } },
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

describe('DispatchService', () => {
  it('runs the scoped child and completes the task', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const developer = runtime.agents.findByRole('developer')!
    const task = runtime.tasks.create({ projectId, title: 'Написать отчёт', assignedAgentId: developer.id })
    const captured: { input?: ScopedRunInput } = {}
    const service = new DispatchService(
      fakeContext(),
      runtime,
      runner({ childId: 'ses_child', output: 'Отчёт готов. Проверено тестом.', stopReason: 'completed', diagnostic: '' }, captured),
    )

    const output = await service.dispatch({ taskId: task.id }, fakeExec())

    expect(output.stopReason).toBe('completed')
    expect(output.childId).toBe('ses_child')
    expect(output.taskStatus).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).status).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).result).toContain('Отчёт готов')
    expect(captured.input?.profile.id).toBe(developer.id)
    expect(captured.input?.profile.allowedTools).toContain('read')
    expect(captured.input?.profile.allowedTools).not.toContain('factory_dispatch')
    expect(captured.input?.cwd).toBe(runtime.projects.require(projectId).rootPath)
    expect(captured.input?.prompt).toContain('DEVELOPER')
  })

  it('leaves the task in REVIEW when review=true', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Подготовить ревью' })
    const service = new DispatchService(
      fakeContext(),
      runtime,
      runner({ childId: 'ses_child', output: 'Результат для ревью.', stopReason: 'completed', diagnostic: '' }),
    )

    const output = await service.dispatch({ taskId: task.id, review: true }, fakeExec())

    expect(output.taskStatus).toBe('REVIEW')
    expect(runtime.tasks.require(task.id).status).toBe('REVIEW')
    expect(runtime.tasks.require(task.id).result).toContain('Результат для ревью')
  })

  it('marks the task for retry when the child fails', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Падающая задача', maxAttempts: 2 })
    const service = new DispatchService(
      fakeContext(),
      runtime,
      runner({ childId: 'ses_child', output: '', stopReason: 'error', diagnostic: 'child failed' }),
    )

    const output = await service.dispatch({ taskId: task.id }, fakeExec())

    expect(output.stopReason).toBe('error')
    expect(output.taskStatus).toBe('READY')
    expect(runtime.tasks.require(task.id).attempts).toBe(1)
    expect(runtime.tasks.require(task.id).error).toContain('child failed')
  })

  it('fails without claiming when ctx.agents is unavailable', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Без agents' })
    await expect(
      new DispatchService(fakeContext(), runtime).dispatch({ taskId: task.id }, fakeExec()),
    ).rejects.toThrowError(/ctx\.agents/)
    expect(runtime.tasks.require(task.id).status).toBe('READY')
  })

  it('refuses a profile with an empty allowlist', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const agent = runtime.agents.create({ name: 'EMPTY', role: 'custom', allowedTools: [] })
    const task = runtime.tasks.create({ projectId, title: 'Без allowlist', assignedAgentId: agent.id })
    await expect(
      new DispatchService(fakeContext(), runtime, runner({ childId: 'x', output: 'x', stopReason: 'completed', diagnostic: '' })).dispatch(
        { taskId: task.id },
        fakeExec(),
      ),
    ).rejects.toThrowError(/allowedTools/)
    expect(runtime.tasks.require(task.id).status).toBe('READY')
  })
})
