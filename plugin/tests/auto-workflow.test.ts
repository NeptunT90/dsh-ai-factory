import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ChildRunner, ScopedRunInput, ScopedRunResult } from '../src/agents/scoped-runner.js'
import { AutoWorkflowService } from '../src/workflow/auto.js'
import { createTestRuntime, track } from './helpers.js'

function coordinator(): Agent {
  return {
    id: 'ses_coordinator',
    options: { provider: 'fake', model: 'fake-model' },
    session: { header: { cwd: 'C:/workspace' } },
  } as unknown as Agent
}

function fakeContext(agent: Agent, disposed: { count: number }): Context {
  return {
    get(name: string) {
      if (name !== 'agents') return undefined
      return {
        async create() {
          return {
            agent,
            dispose: async () => {
              disposed.count += 1
            },
          }
        },
      }
    },
  } as unknown as Context
}

function runner(): ChildRunner {
  return {
    async run(input: ScopedRunInput): Promise<ScopedRunResult> {
      if (input.profile.role === 'reviewer') {
        return {
          childId: 'ses_review',
          output: 'VERDICT: PASS\nПроверено.',
          stopReason: 'completed',
          diagnostic: '',
        }
      }
      return {
        childId: 'ses_exec',
        output: 'готово',
        stopReason: 'completed',
        diagnostic: '',
      }
    },
  }
}

describe('AutoWorkflowService', () => {
  it('runs a READY task through the workflow using a coordinator parent', async () => {
    const { runtime, projectId } = track(
      createTestRuntime({
        autoWorkflowEnabled: true,
        autoWorkflowMaxCycles: 1,
        autoWorkflowMaxTasks: 1,
      }),
    )
    const task = runtime.tasks.create({ projectId, title: 'Автономная задача' })
    const disposed = { count: 0 }
    const service = new AutoWorkflowService(fakeContext(coordinator(), disposed), runtime, runner())

    const results = await service.tickOnce()

    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('PASSED')
    expect(runtime.tasks.require(task.id).status).toBe('COMPLETED')
    await service.stop()
    expect(disposed.count).toBe(1)
  })

  it('does nothing when autonomous workflow is disabled', async () => {
    const { runtime } = track(createTestRuntime({ autoWorkflowEnabled: false }))
    const disposed = { count: 0 }
    const service = new AutoWorkflowService(fakeContext(coordinator(), disposed), runtime, runner())
    expect(await service.tickOnce()).toEqual([])
    expect(disposed.count).toBe(0)
  })
})
