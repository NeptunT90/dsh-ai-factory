import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SubagentActivation, SubagentActivationSpec, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
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

function fakeContext(service: unknown): Context {
  return {
    get(name: string) {
      return name === 'subagents' ? service : undefined
    },
  } as unknown as Context
}

function activation(result: Promise<unknown>): SubagentActivation {
  return {
    childId: 'ses_child' as never,
    result: result as SubagentActivation['result'],
    dispose: async () => {},
  }
}

describe('DispatchService', () => {
  it('spawns a child through ctx.subagents and completes the task', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const developer = runtime.agents.findByRole('developer')!
    const task = runtime.tasks.create({ projectId, title: 'Написать отчёт', assignedAgentId: developer.id })
    let captured: SubagentActivationSpec | undefined
    const fake = {
      startActivation: async (spec: SubagentActivationSpec) => {
        captured = spec
        return activation(
          Promise.resolve({
            output: [{ type: 'text', text: 'Отчёт готов. Проверено тестом.' }],
            stopReason: 'completed',
          }),
        )
      },
    } as unknown as SubagentRuntime

    const output = await new DispatchService(fakeContext(fake), runtime).dispatch({ taskId: task.id }, fakeExec())

    expect(output.stopReason).toBe('completed')
    expect(output.childId).toBe('ses_child')
    expect(output.taskStatus).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).status).toBe('COMPLETED')
    expect(runtime.tasks.require(task.id).result).toContain('Отчёт готов')
    expect(captured?.provider).toBe('spawn')
    expect(captured?.delivery).toBe('caller')
    expect(captured?.request.cwd).toBe(runtime.projects.require(projectId).rootPath)
    expect(captured?.request.prompt[0]).toMatchObject({ type: 'text' })
    expect((captured?.request.prompt[0] as { text: string }).text).toContain('DEVELOPER')
  })

  it('marks the task for retry when the child fails', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Падающая задача', maxAttempts: 2 })
    const fake = {
      startActivation: async () =>
        activation(
          Promise.resolve({
            output: [],
            stopReason: 'error',
            diagnostic: 'child failed',
          }),
        ),
    } as unknown as SubagentRuntime

    const output = await new DispatchService(fakeContext(fake), runtime).dispatch({ taskId: task.id }, fakeExec())

    expect(output.stopReason).toBe('error')
    expect(output.taskStatus).toBe('READY')
    expect(runtime.tasks.require(task.id).attempts).toBe(1)
    expect(runtime.tasks.require(task.id).error).toContain('child failed')
  })

  it('fails without claiming the task when ctx.subagents is unavailable', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Без subagents' })
    await expect(
      new DispatchService(fakeContext(undefined), runtime).dispatch({ taskId: task.id }, fakeExec()),
    ).rejects.toThrowError(/ctx\.subagents/)
    expect(runtime.tasks.require(task.id).status).toBe('READY')
  })
})
