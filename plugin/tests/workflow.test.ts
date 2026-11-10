import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ChildRunner, ScopedRunInput, ScopedRunResult } from '../src/agents/scoped-runner.js'
import { WorkflowService } from '../src/workflow/service.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(): ToolRunContext {
  return {
    callId: 'call_workflow',
    name: 'factory_workflow_run',
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

function scriptedRunner(verdicts: Array<'FAIL' | 'PASS'>): ChildRunner {
  let executors = 0
  let reviewers = 0
  return {
    async run(input: ScopedRunInput): Promise<ScopedRunResult> {
      if (input.profile.role === 'reviewer') {
        const verdict = verdicts[reviewers] ?? 'PASS'
        reviewers += 1
        return {
          childId: `ses_reviewer_${reviewers}`,
          output:
            verdict === 'PASS'
              ? 'VERDICT: PASS\nПроверено.'
              : 'VERDICT: FAIL\nНужны исправления.\n- Недостаточно доказательств',
          stopReason: 'completed',
          diagnostic: '',
        }
      }
      executors += 1
      return {
        childId: `ses_executor_${executors}`,
        output: `Результат исполнителя ${executors}.`,
        stopReason: 'completed',
        diagnostic: '',
      }
    },
  }
}

describe('WorkflowService', () => {
  it('runs executor → FAIL → fix task → PASS and stops', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const developer = runtime.agents.findByRole('developer')!
    const task = runtime.tasks.create({ projectId, title: 'Автономная задача', assignedAgentId: developer.id })
    const service = new WorkflowService(fakeContext(), runtime, scriptedRunner(['FAIL', 'PASS']))

    const result = await service.run({ taskId: task.id, maxCycles: 3 }, fakeExec())

    expect(result.status).toBe('PASSED')
    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[0]?.verdict).toBe('FAIL')
    expect(result.cycles[1]?.verdict).toBe('PASS')
    expect(runtime.tasks.require(task.id).status).toBe('FAILED')
    expect(runtime.tasks.require(result.cycles[1]!.taskId).status).toBe('COMPLETED')
    expect(result.finalTaskId).toContain('tsk_')
  })

  it('stops as EXHAUSTED when maxCycles is spent', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Бесконечный FAIL' })
    const service = new WorkflowService(fakeContext(), runtime, scriptedRunner(['FAIL', 'FAIL']))

    const result = await service.run({ taskId: task.id, maxCycles: 1 }, fakeExec())

    expect(result.status).toBe('EXHAUSTED')
    expect(result.cycles).toHaveLength(1)
    const fix = runtime.tasks.require(result.finalTaskId)
    expect(fix.status).toBe('READY')
  })

  it('returns ERROR without claiming when ctx.agents is missing', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Без agents' })
    const result = await new WorkflowService(fakeContext(), runtime).run(
      { taskId: task.id, maxCycles: 1 },
      fakeExec(),
    )
    expect(result.status).toBe('ERROR')
    expect(result.message).toContain('ctx.agents')
    expect(runtime.tasks.require(task.id).status).toBe('READY')
  })
})
