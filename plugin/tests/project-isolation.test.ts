import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../src/core/errors.js'
import type { FactoryRuntime } from '../src/runtime.js'
import { ProjectScopeService } from '../src/projects/policy.js'
import { DispatchService } from '../src/dispatch/service.js'
import { ReviewerService } from '../src/reviewer/service.js'
import { WorkflowService } from '../src/workflow/service.js'
import { registerTaskTools } from '../src/tasks/tools.js'
import { registerMemoryTools } from '../src/memory/tools.js'
import { registerSyncTool } from '../src/sync/tools.js'
import { DashboardServer } from '../src/dashboard/server.js'
import { createTestRuntime, track } from './helpers.js'

function expectMismatch(fn: () => unknown): void {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ code: 'PROJECT_MISMATCH' })
    return
  }
  throw new Error('expected PROJECT_MISMATCH')
}

function fakeExec(cwd: string): ToolRunContext {
  return {
    callId: 'call_isolation',
    name: 'factory_test',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: 'ses_parent',
      options: { provider: 'fake', model: 'fake-model' },
      session: { header: { cwd } },
    },
  } as unknown as ToolRunContext
}

function captureTools(register: (ctx: Context) => unknown): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
  } as unknown as Context
  register(ctx)
  return tools
}

function taskRuntime(projectId: string, target: string): FactoryRuntime {
  return {
    scope: {
      current: () => ({ id: projectId }),
      assertTask: () => undefined,
      requireSame: () => {
        throw new FactoryError('PROJECT_MISMATCH', 'project mismatch')
      },
    },
    projectFor: () => ({ id: projectId }),
    tasks: {
      requireForProject: () => {
        throw new FactoryError('PROJECT_MISMATCH', 'task mismatch')
      },
      recoverStaleForProject: () => {
        throw new FactoryError('PROJECT_MISMATCH', 'recover mismatch')
      },
    },
    target,
  } as unknown as FactoryRuntime
}

describe('project context isolation', () => {
  it('ProjectScopeService enforces explicit, task and memory project boundaries', () => {
    const { runtime } = track(createTestRuntime())
    const projectA = runtime.projects.ensure(join(runtime.config.resolvedDataDir, 'a'), 'A')
    const projectB = runtime.projects.ensure(join(runtime.config.resolvedDataDir, 'b'), 'B')
    const execA = fakeExec(projectA.rootPath)

    expect(runtime.scope.current(execA).id).toBe(projectA.id)
    expectMismatch(() => runtime.scope.requireSame(execA, projectB.id, 'write'))
    expect(() => runtime.scope.requireSame(execA, projectA.id, 'write')).not.toThrow()

    const taskB = runtime.tasks.create({ projectId: projectB.id, title: 'B task' })
    expectMismatch(() => runtime.scope.assertTask(execA, taskB, 'write'))
    expectMismatch(() => runtime.tasks.requireForProject(taskB.id, projectA.id))
    expect(runtime.tasks.requireForProject(taskB.id, projectB.id).id).toBe(taskB.id)

    const memoryB = runtime.memory.remember({ projectId: projectB.id, content: 'B memory', title: 'B' })
    expectMismatch(() => runtime.scope.assertMemory(execA, memoryB.entry, 'read'))
    const global = runtime.memory.remember({ scope: 'global', content: 'global memory', title: 'G' })
    expect(() => runtime.scope.assertMemory(execA, global.entry, 'read')).not.toThrow()
  })

  it('task tool gates reject all id-addressed mutations before engine calls', async () => {
    const exec = fakeExec('C:/workspace-a')
    const runtime = taskRuntime('prj_a', 'tsk_b')
    const tools = captureTools((ctx) =>
      registerTaskTools(ctx, () => runtime, () => undefined),
    )
    const cases: Array<[string, Record<string, unknown>]> = [
      ['factory_task_get', { id: 'tsk_b' }],
      ['factory_task_update', { id: 'tsk_b' }],
      ['factory_task_claim', { id: 'tsk_b' }],
      ['factory_task_heartbeat', { id: 'tsk_b' }],
      ['factory_task_review', { id: 'tsk_b' }],
      ['factory_task_complete', { id: 'tsk_b' }],
      ['factory_task_fail', { id: 'tsk_b', error: 'x' }],
      ['factory_task_cancel', { id: 'tsk_b' }],
      ['factory_task_retry', { id: 'tsk_b' }],
      ['factory_task_events', { id: 'tsk_b' }],
      ['factory_task_recover', {}],
      ['factory_task_create', { title: 'x', projectId: 'prj_b' }],
      ['factory_task_list', { projectId: 'prj_b' }],
      ['factory_task_stats', { projectId: 'prj_b' }],
    ]
    for (const [name, args] of cases) {
      await expect(tools.get(name)!.execute(args, exec)).rejects.toMatchObject({ code: 'PROJECT_MISMATCH' })
    }
  })

  it('memory tool gates reject get/update/forget/history for another project', async () => {
    const exec = fakeExec('C:/workspace-a')
    const runtime = {
      memory: {
        require: () => ({ id: 'mem_b', projectId: 'prj_b' }),
      },
      scope: {
        assertMemory: () => {
          throw new FactoryError('PROJECT_MISMATCH', 'memory mismatch')
        },
      },
    } as unknown as FactoryRuntime
    const tools = captureTools((ctx) =>
      registerMemoryTools(ctx, () => runtime, () => undefined),
    )
    for (const name of ['factory_memory_get', 'factory_memory_update', 'factory_memory_forget', 'factory_memory_history']) {
      await expect(tools.get(name)!.execute({ id: 'mem_b' }, exec)).rejects.toMatchObject({ code: 'PROJECT_MISMATCH' })
    }
  })

  it('dispatch, review and workflow fail before claim/child for another project', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const projectB = runtime.projects.ensure(join(runtime.config.resolvedDataDir, 'b'), 'B')
    const execA = fakeExec(runtime.projects.require(projectId).rootPath)
    const runner = { run: vi.fn() }
    const dispatchService = new DispatchService({} as Context, runtime, runner)
    const reviewService = new ReviewerService({} as Context, runtime, runner)
    const workflowService = new WorkflowService({} as Context, runtime, runner)

    const ready = runtime.tasks.create({ projectId: projectB.id, title: 'B ready' })
    await expect(dispatchService.dispatch({ taskId: ready.id }, execA)).rejects.toMatchObject({
      code: 'PROJECT_MISMATCH',
    })
    expect(runner.run).not.toHaveBeenCalled()
    expect(runtime.tasks.require(ready.id).status).toBe('READY')

    const reviewTask = runtime.tasks.create({ projectId: projectB.id, title: 'B review' })
    runtime.tasks.claim(reviewTask.id, { owner: 'executor' })
    runtime.tasks.submitForReview(reviewTask.id, 'executor', 'result')
    await expect(reviewService.review({ taskId: reviewTask.id }, execA)).rejects.toMatchObject({
      code: 'PROJECT_MISMATCH',
    })
    expect(runtime.tasks.require(reviewTask.id).status).toBe('REVIEW')

    await expect(workflowService.run({ taskId: ready.id }, execA)).rejects.toMatchObject({
      code: 'PROJECT_MISMATCH',
    })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('child prompt and ScopedRunInput carry project id and root', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'A task' })
    const captured: { input?: { projectId?: string; prompt?: string; cwd?: string } } = {}
    const runner = {
      async run(input: { projectId?: string; prompt?: string; cwd?: string }) {
        captured.input = input
        return { childId: 'ses_child', output: 'done', stopReason: 'completed', diagnostic: '' }
      },
    }
    await new DispatchService({} as Context, runtime, runner).dispatch(
      { taskId: task.id },
      fakeExec(runtime.projects.require(projectId).rootPath),
    )
    expect(captured.input?.projectId).toBe(projectId)
    expect(captured.input?.cwd).toBe(runtime.projects.require(projectId).rootPath)
    expect(captured.input?.prompt).toContain(projectId)
    expect(captured.input?.prompt).toContain('Project root:')
  })

  it('factory_sync is FORBIDDEN for a child-scoped caller', async () => {
    let definition: ToolDefinition | undefined
    const ctx = {
      tools: {
        register(value: ToolDefinition) {
          definition = value
          return () => undefined
        },
      },
    } as unknown as Context
    const runtime = { hasChildAllowlist: () => true } as unknown as FactoryRuntime
    registerSyncTool(ctx, () => runtime, () => undefined)
    await expect(
      definition!.execute({ action: 'status' }, { agent: { id: 'ses_child' } } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('audit records actorProjectId and targetProjectId', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const projectB = runtime.projects.ensure(join(runtime.config.resolvedDataDir, 'b'), 'B')
    runtime.auditTool('isolation.audit', projectB, fakeExec(runtime.projects.require(projectId).rootPath), { taskId: 'x' })
    const event = runtime.audit.recent(10).find((entry) => entry.event === 'isolation.audit')
    expect(event?.projectId).toBe(projectB.id)
    expect(event?.data.actorProjectId).toBe(projectId)
    expect(event?.data.targetProjectId).toBe(projectB.id)
  })

  it('writes project.override_active when projectIdOverride is set', () => {
    const { runtime } = track(createTestRuntime({ projectIdOverride: 'prj_override' }))
    const event = runtime.audit.recent(20).find((entry) => entry.event === 'project.override_active')
    expect(event?.data.projectId).toBe('prj_override')
  })

  it('dashboard project filter limits tasks and memory', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const projectB = runtime.projects.ensure(join(runtime.config.resolvedDataDir, 'b'), 'B')
    runtime.tasks.create({ projectId, title: 'A task' })
    runtime.tasks.create({ projectId: projectB.id, title: 'B task' })
    runtime.memory.remember({ projectId, content: 'A memory', title: 'A' })
    runtime.memory.remember({ projectId: projectB.id, content: 'B memory', title: 'B' })
    const server = new DashboardServer(runtime, () => [], { projectId: projectB.id })
    try {
      const started = await server.start()
      const response = await fetch(`http://127.0.0.1:${started.port}/api/state`, {
        headers: { Authorization: `Bearer ${started.token}` },
      })
      const state = (await response.json()) as {
        overview: { projectFilter: string | null; projects: number }
        tasks: Array<{ projectId: string }>
        memory: Array<{ projectId: string | null }>
      }
      expect(state.overview.projectFilter).toBe(projectB.id)
      expect(state.overview.projects).toBe(1)
      expect(state.tasks.every((task) => task.projectId === projectB.id)).toBe(true)
      expect(state.memory.every((entry) => entry.projectId === projectB.id)).toBe(true)
    } finally {
      await server.stop()
    }
  })
})
