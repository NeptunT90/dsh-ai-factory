import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerTaskTools } from '../src/tasks/tools.js'
import { TOOL_HEALTH_SPECS } from '../src/health/registry.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_task_tell',
    name: 'factory_task_tell',
    arguments: {},
    signal: new AbortController().signal,
    agent: { id: agentId, session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

function toolsFor(runtime: ReturnType<typeof createTestRuntime>['runtime']): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      definitions() {
        return []
      },
    },
  } as unknown as Context
  registerTaskTools(ctx, () => runtime, () => undefined)
  return tools
}

describe('factory_task_tell', () => {
  it('stores feedback in metadata for a READY task', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Feedback metadata' })
    const result = (await toolsFor(runtime).get('factory_task_tell')!.execute(
      { taskId: task.id, message: 'Используй Node.js' },
      fakeExec('ses_root', project.rootPath),
    )) as { delivered: boolean; channel: string; feedbackCount: number }
    expect(result.delivered).toBe(false)
    expect(result.channel).toBe('metadata')
    expect(result.feedbackCount).toBe(1)
    const updated = runtime.tasks.require(task.id)
    expect(updated.metadata.feedback).toEqual([
      expect.objectContaining({ message: 'Используй Node.js', status: 'READY', channel: 'metadata' }),
    ])
  })

  it('delivers a followup to the active RUNNING child', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Feedback running' })
    runtime.tasks.claim(task.id, { owner: 'ses_parent', leaseMs: 60_000 })
    const received: string[] = []
    runtime.registerActiveChild(task.id, 'ses_child', (message) => received.push(message))
    const result = (await toolsFor(runtime).get('factory_task_tell')!.execute(
      { taskId: task.id, message: 'Стоп, используй Node.js' },
      fakeExec('ses_root', project.rootPath),
    )) as { delivered: boolean; channel: string; childId: string }
    expect(result.delivered).toBe(true)
    expect(result.channel).toBe('child')
    expect(result.childId).toBe('ses_child')
    expect(received).toEqual(['Стоп, используй Node.js'])
    expect(runtime.tasks.require(task.id).metadata.feedback).toBeUndefined()
  })

  it('falls back to metadata for RUNNING without an active child', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'No active child' })
    runtime.tasks.claim(task.id, { owner: 'ses_parent', leaseMs: 60_000 })
    const result = (await toolsFor(runtime).get('factory_task_tell')!.execute(
      { taskId: task.id, message: 'Не трогай production' },
      fakeExec('ses_root', project.rootPath),
    )) as { delivered: boolean; channel: string; status: string }
    expect(result.delivered).toBe(false)
    expect(result.channel).toBe('metadata')
    expect(result.status).toBe('RUNNING')
    expect(runtime.tasks.require(task.id).metadata.feedback).toHaveLength(1)
  })

  it('rejects secrets, empty messages and child callers', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Feedback security' })
    const fakeGithubToken = 'ghp_' + 'a'.repeat(36)
    const tools = toolsFor(runtime)
    const root = fakeExec('ses_root', project.rootPath)
    await expect(tools.get('factory_task_tell')!.execute({ taskId: task.id, message: '' }, root)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      tools.get('factory_task_tell')!.execute({ taskId: task.id, message: `token = ${fakeGithubToken}` }, root),
    ).rejects.toMatchObject({ code: 'SECRET_DETECTED' })
    runtime.allowToolsForChild('ses_child', ['factory_task_tell'])
    await expect(
      tools.get('factory_task_tell')!.execute(
        { taskId: task.id, message: 'hello' },
        fakeExec('ses_child', project.rootPath),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('updates the health registry to 54 tools / 62 actions', () => {
    expect(new Set(TOOL_HEALTH_SPECS.map((spec) => spec.tool)).size).toBe(63)
    expect(TOOL_HEALTH_SPECS).toHaveLength(71)
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_task_tell')?.risk).toBe('R1')
  })
})
