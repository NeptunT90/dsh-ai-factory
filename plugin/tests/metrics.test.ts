import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { collectTaskSteps } from '../src/agents/scoped-runner.js'
import { registerMetricsTool } from '../src/metrics/tools.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_metrics',
    name: 'factory_metrics',
    arguments: {},
    signal: new AbortController().signal,
    agent: { id: agentId, session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

function capture(runtime: ReturnType<typeof createTestRuntime>['runtime']): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      definitions() { return [] },
    },
  } as unknown as Context
  registerMetricsTool(ctx, () => runtime, () => undefined)
  return tools
}

describe('task trajectory and metrics', () => {
  it('collects only tool metadata from session events', () => {
    const steps = collectTaskSteps([
      { type: 'tool/call', time: 1000, data: { callId: 'c1', name: 'read', arguments: '{"path":"secret"}' } },
      { type: 'tool/result', time: 1300, data: { message: { toolCallId: 'c1', isError: false } } },
      { type: 'tool/call', time: 1400, data: { callId: 'c2', name: 'pwsh', arguments: '{"command":"rm -rf /"}' } },
      { type: 'tool/result', time: 1500, data: { message: { toolCallId: 'c2', isError: true }, error: { code: 'TOOL_NOT_ALLOWED' } } },
    ])
    expect(steps).toEqual([
      { seq: 0, toolName: 'read', ok: true, errorCode: null, durationMs: 300 },
      { seq: 1, toolName: 'pwsh', ok: false, errorCode: 'TOOL_NOT_ALLOWED', durationMs: 100 },
    ])
    expect(JSON.stringify(steps)).not.toContain('secret')
    expect(JSON.stringify(steps)).not.toContain('rm -rf')
  })

  it('persists task_steps and computes metrics', async () => {
    const { runtime, dir, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const completed = runtime.tasks.create({ projectId, title: 'Completed task' })
    const failed = runtime.tasks.create({ projectId, title: 'Failed task' })
    const retry = runtime.tasks.create({ projectId, title: 'Retry task' })
    runtime.db.run("UPDATE tasks SET status='COMPLETED', attempts=3 WHERE id=?", [completed.id])
    runtime.db.run("UPDATE tasks SET status='FAILED', attempts=2 WHERE id=?", [failed.id])
    runtime.db.run("UPDATE tasks SET status='COMPLETED', attempts=1 WHERE id=?", [retry.id])
    runtime.recordTaskSteps(completed.id, projectId, [
      { seq: 0, toolName: 'read', ok: true, errorCode: null, durationMs: 10 },
      { seq: 1, toolName: 'pwsh', ok: false, errorCode: 'TOOL_ERROR', durationMs: 20 },
      { seq: 2, toolName: 'pwsh', ok: false, errorCode: 'TOOL_ERROR', durationMs: 25 },
    ])
    const steps = runtime.db.all<{ tool_name: string; ok: number }>('SELECT tool_name, ok FROM task_steps WHERE task_id=? ORDER BY seq', [completed.id])
    expect(steps).toEqual([{ tool_name: 'read', ok: 1 }, { tool_name: 'pwsh', ok: 0 }, { tool_name: 'pwsh', ok: 0 }])
    const tools = capture(runtime)
    const result = (await tools.get('factory_metrics')!.execute({}, fakeExec('ses_root', project.rootPath))) as {
      tasksTotal: number
      completed: number
      failed: number
      successRate: number
      avgAttempts: number
      retryRate: number
      toolErrorTop: Array<{ tool: string; errorCode: string; count: number }>
    }
    expect(result.tasksTotal).toBe(3)
    expect(result.completed).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.successRate).toBeCloseTo(2 / 3)
    expect(result.avgAttempts).toBeCloseTo(2)
    expect(result.retryRate).toBeCloseTo(2 / 3)
    expect(result.toolErrorTop).toEqual([{ tool: 'pwsh', errorCode: 'TOOL_ERROR', count: 2 }])
  })

  it('keeps factory_metrics root-only and health count current', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const tools = capture(runtime)
    runtime.allowToolsForChild('ses_child', ['factory_metrics'])
    await expect(tools.get('factory_metrics')!.execute({}, fakeExec('ses_child', project.rootPath))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(tools.has('factory_metrics')).toBe(true)
  })
})
