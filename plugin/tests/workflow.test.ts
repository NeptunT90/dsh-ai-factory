import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
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

function fakeContext(service: unknown): Context {
  return {
    get(name: string) {
      return name === 'subagents' ? service : undefined
    },
  } as unknown as Context
}

function activation(childId: string, result: unknown): SubagentActivation {
  return {
    childId: childId as never,
    result: Promise.resolve(result) as SubagentActivation['result'],
    dispose: async () => {},
  }
}

function scriptedSubagents(verdicts: Array<'FAIL' | 'PASS'>) {
  let executors = 0
  let reviewers = 0
  return {
    startActivation: async (spec: SubagentActivationSpec) => {
      if (spec.request.outputSchema) {
        const verdict = verdicts[reviewers] ?? 'PASS'
        reviewers += 1
        return activation(`ses_reviewer_${reviewers}`, {
          output: [],
          structured: {
            verdict,
            summary: verdict === 'PASS' ? 'Проверено.' : 'Нужны исправления.',
            issues: verdict === 'PASS' ? [] : ['Недостаточно доказательств'],
          },
          stopReason: 'completed',
        })
      }
      executors += 1
      return activation(`ses_executor_${executors}`, {
        output: [{ type: 'text', text: `Результат исполнителя ${executors}.` }],
        stopReason: 'completed',
      })
    },
  } as unknown as SubagentRuntime
}

describe('WorkflowService', () => {
  it('runs executor → FAIL → fix task → PASS and stops', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const developer = runtime.agents.findByRole('developer')!
    const task = runtime.tasks.create({ projectId, title: 'Автономная задача', assignedAgentId: developer.id })
    const fake = scriptedSubagents(['FAIL', 'PASS'])

    const result = await new WorkflowService(fakeContext(fake), runtime).run(
      { taskId: task.id, maxCycles: 3 },
      fakeExec(),
    )

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
    const fake = scriptedSubagents(['FAIL', 'FAIL'])

    const result = await new WorkflowService(fakeContext(fake), runtime).run(
      { taskId: task.id, maxCycles: 1 },
      fakeExec(),
    )

    expect(result.status).toBe('EXHAUSTED')
    expect(result.cycles).toHaveLength(1)
    const fix = runtime.tasks.require(result.finalTaskId)
    expect(fix.status).toBe('READY')
  })

  it('returns ERROR without claiming when ctx.subagents is missing', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'Без subagents' })
    const result = await new WorkflowService(fakeContext(undefined), runtime).run(
      { taskId: task.id, maxCycles: 1 },
      fakeExec(),
    )
    expect(result.status).toBe('ERROR')
    expect(result.message).toContain('ctx.subagents')
    expect(runtime.tasks.require(task.id).status).toBe('READY')
  })
})
