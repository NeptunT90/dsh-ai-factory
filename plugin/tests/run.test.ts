import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { RunService } from '../src/dispatch/run.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(cwd: string): ToolRunContext {
  return {
    callId: 'call_run',
    name: 'factory_run',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: 'ses_root',
      options: { provider: 'fake', model: 'fake-model' },
      session: { header: { cwd }, append() { return 1 } },
    },
  } as unknown as ToolRunContext
}

describe('RunService / factory_run', () => {
  it('creates the task and starts it in one call', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const before = runtime.tasks.list({ projectId, includeTerminal: true, limit: 100 }).length
    const events: Array<{ type: string; data: unknown }> = []
    const exec = fakeExec(project.rootPath)
    ;(exec.agent as unknown as { session: { append: (type: string, data: unknown) => void } }).session.append = (type, data) => { events.push({ type, data }) }
    const service = new RunService({} as Context, runtime, {
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return { childId: 'ses_run', output: 'готово', stopReason: 'completed', diagnostic: '' }
      },
    })
    const result = await service.run({
      projectId,
      title: 'One-call article',
      description: 'Напиши статью',
      role: 'developer',
      async: true,
    }, exec)
    expect(result.taskId).toBeTruthy()
    expect(result.async).toBe(true)
    expect(runtime.tasks.list({ projectId, includeTerminal: true, limit: 100 }).length).toBe(before + 1)
    expect(runtime.tasks.require(result.taskId).status).toBe('RUNNING')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(runtime.tasks.require(result.taskId).status).toBe('COMPLETED')
    expect(events.some((event) => event.type === 'assistant/message')).toBe(true)
  })
})
