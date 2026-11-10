import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ChildRunner, ScopedRunInput, ScopedRunResult } from '../src/agents/scoped-runner.js'
import { DispatchService } from '../src/dispatch/service.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(cwd = 'C:/workspace'): ToolRunContext {
  return {
    callId: 'call_dispatch',
    name: 'factory_dispatch',
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

    const output = await service.dispatch({ taskId: task.id }, fakeExec(runtime.projects.require(projectId).rootPath))

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

    const output = await service.dispatch({ taskId: task.id, review: true }, fakeExec(runtime.projects.require(projectId).rootPath))

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

    const output = await service.dispatch({ taskId: task.id }, fakeExec(runtime.projects.require(projectId).rootPath))

    expect(output.stopReason).toBe('error')
    expect(output.taskStatus).toBe('READY')
    expect(runtime.tasks.require(task.id).attempts).toBe(1)
    expect(runtime.tasks.require(task.id).error).toContain('child failed')
  })

  it('retries with the configured fallback model after a child error', async () => {
    const { runtime, projectId } = track(
      createTestRuntime({ modelFallbacks: 'fb/one', modelMaxAttempts: 2 }),
    )
    const task = runtime.tasks.create({ projectId, title: 'Fallback route' })
    const calls: string[] = []
    const fallbackRunner: ChildRunner = {
      async run(input) {
        calls.push(String(input.agentOptions?.provider) + '/' + String(input.agentOptions?.model))
        return calls.length === 1
          ? { childId: 'ses_first', output: '', stopReason: 'error', diagnostic: 'model unavailable' }
          : { childId: 'ses_second', output: 'fallback ok', stopReason: 'completed', diagnostic: '' }
      },
    }
    const output = await new DispatchService(fakeContext(), runtime, fallbackRunner).dispatch(
      { taskId: task.id },
      fakeExec(runtime.projects.require(projectId).rootPath),
    )
    expect(output.taskStatus).toBe('COMPLETED')
    expect(output.childId).toBe('ses_second')
    expect(calls).toEqual(['fake/fake-model', 'fb/one'])
    expect(runtime.tasks.require(task.id).result).toContain('fallback ok')
  })

  it('does not repeat fallback after a successful tool call side effect', async () => {
    const { runtime, projectId } = track(
      createTestRuntime({ modelFallbacks: 'fb/one', modelMaxAttempts: 2 }),
    )
    const task = runtime.tasks.create({ projectId, title: 'Side effect fallback' })
    const calls: string[] = []
    const sideEffectRunner: ChildRunner = {
      async run(input) {
        calls.push(String(input.agentOptions?.provider) + '/' + String(input.agentOptions?.model))
        return {
          childId: 'ses_side_effect',
          output: '',
          stopReason: 'error',
          diagnostic: 'child failed after writing',
          toolCalls: 1,
          successfulTools: 1,
        }
      },
    }
    const output = await new DispatchService(fakeContext(), runtime, sideEffectRunner).dispatch(
      { taskId: task.id },
      fakeExec(runtime.projects.require(projectId).rootPath),
    )
    expect(calls).toHaveLength(1)
    expect(output.stopReason).toBe('error')
    expect(output.taskStatus).toBe('READY')
    expect(runtime.audit.recent(50).some((entry) => entry.event === 'model.fallback_suppressed')).toBe(true)
  })

  it('fails without claiming when ctx.agents is unavailable', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Без agents' })
    await expect(
      new DispatchService(fakeContext(), runtime).dispatch({ taskId: task.id }, fakeExec(runtime.projects.require(projectId).rootPath)),
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
        fakeExec(runtime.projects.require(projectId).rootPath),
      ),
    ).rejects.toThrowError(/allowedTools/)
    expect(runtime.tasks.require(task.id).status).toBe('READY')
  })
})
