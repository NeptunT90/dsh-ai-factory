import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { DispatchService } from '../dispatch/service.js'
import { ReviewerService } from '../reviewer/service.js'
import type { ChildRunner } from '../agents/scoped-runner.js'

export interface WorkflowInput {
  readonly taskId: string
  readonly maxCycles?: number
  readonly reviewerAgentId?: string
  readonly instructions?: string
}

export interface WorkflowCycle {
  readonly cycle: number
  readonly taskId: string
  readonly dispatchStatus: string
  readonly verdict: string
  readonly reviewerChildId: string
  readonly fixTaskId: string
  readonly taskStatus: string
}

export interface WorkflowResult {
  readonly status: 'PASSED' | 'FAILED' | 'EXHAUSTED' | 'ERROR'
  readonly cycles: WorkflowCycle[]
  readonly finalTaskId: string
  readonly fixTaskId: string
  readonly message: string
}

/**
 * Bounded autonomous loop: executor dispatch (leaving the task in REVIEW) →
 * independent reviewer → fix task → repeat. The loop stops on PASS/PM
 * PASS_WITH_WARNINGS, on a hard dispatch failure, or when maxCycles is spent.
 */
export class WorkflowService {
  constructor(
    private readonly ctx: Context,
    private readonly runtime: FactoryRuntime,
    private readonly runner?: ChildRunner,
  ) {}

  async run(input: WorkflowInput, exec: ToolRunContext): Promise<WorkflowResult> {
    const runtime = this.runtime
    const maxCycles = Math.max(1, Math.min(5, Math.floor(input.maxCycles ?? 3)))
    let currentId = input.taskId
    const cycles: WorkflowCycle[] = []
    let lastFix = ''
    runtime.audit.record({
      event: 'workflow.started',
      level: 'info',
      actor: exec.agent?.id,
      data: { taskId: input.taskId, maxCycles },
    })

    try {
      for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
        let task = runtime.tasks.require(currentId)
        if (task.status === 'COMPLETED') {
          return this.finish('PASSED', cycles, currentId, lastFix, 'Задача уже завершена.')
        }
        if (task.status === 'READY') {
          const dispatch = await new DispatchService(this.ctx, runtime, this.runner).dispatch(
            { taskId: currentId, review: true },
            exec,
          )
          task = runtime.tasks.require(currentId)
          if (dispatch.stopReason !== 'completed' || task.status !== 'REVIEW') {
            const result: WorkflowResult = {
              status: 'FAILED',
              cycles,
              finalTaskId: currentId,
              fixTaskId: lastFix,
              message: `Исполнитель остановлен: ${dispatch.stopReason}; статус ${task.status}.`,
            }
            this.auditFinish(result, input.taskId)
            return result
          }
        } else if (task.status !== 'REVIEW') {
          const result: WorkflowResult = {
            status: 'ERROR',
            cycles,
            finalTaskId: currentId,
            fixTaskId: lastFix,
            message: `Нельзя продолжить workflow из статуса ${task.status}.`,
          }
          this.auditFinish(result, input.taskId)
          return result
        }

        const review = await new ReviewerService(this.ctx, runtime, this.runner).review(
          {
            taskId: currentId,
            ...(input.reviewerAgentId ? { reviewerAgentId: input.reviewerAgentId } : {}),
            ...(input.instructions ? { instructions: input.instructions } : {}),
          },
          exec,
        )
        cycles.push({
          cycle,
          taskId: currentId,
          dispatchStatus: task.status,
          verdict: review.verdict,
          reviewerChildId: review.childId,
          fixTaskId: review.fixTaskId,
          taskStatus: review.taskStatus,
        })
        lastFix = review.fixTaskId || lastFix
        if (review.verdict !== 'FAIL') {
          return this.finish(
            'PASSED',
            cycles,
            currentId,
            review.fixTaskId,
            `Ревью пройдено: ${review.verdict}.`,
          )
        }
        if (!review.fixTaskId) {
          const result: WorkflowResult = {
            status: 'ERROR',
            cycles,
            finalTaskId: currentId,
            fixTaskId: '',
            message: 'REVIEWER вернул FAIL без fix-задачи.',
          }
          this.auditFinish(result, input.taskId)
          return result
        }
        currentId = review.fixTaskId
      }
      const result: WorkflowResult = {
        status: 'EXHAUSTED',
        cycles,
        finalTaskId: currentId,
        fixTaskId: lastFix,
        message: `Лимит ${maxCycles} циклов исчерпан; следующая fix-задача ${currentId} остаётся READY.`,
      }
      this.auditFinish(result, input.taskId)
      return result
    } catch (error) {
      const result: WorkflowResult = {
        status: 'ERROR',
        cycles,
        finalTaskId: currentId,
        fixTaskId: lastFix,
        message: errorMessage(error),
      }
      this.auditFinish(result, input.taskId)
      return result
    }
  }

  private finish(
    status: WorkflowResult['status'],
    cycles: WorkflowCycle[],
    finalTaskId: string,
    fixTaskId: string,
    message: string,
  ): WorkflowResult {
    const result: WorkflowResult = { status, cycles, finalTaskId, fixTaskId, message }
    this.auditFinish(result, cycles[0]?.taskId ?? finalTaskId)
    return result
  }

  private auditFinish(result: WorkflowResult, rootTaskId: string): void {
    this.runtime.audit.record({
      event: `workflow.${result.status.toLowerCase()}`,
      level: result.status === 'PASSED' ? 'info' : 'warn',
      data: {
        rootTaskId,
        finalTaskId: result.finalTaskId,
        fixTaskId: result.fixTaskId,
        cycles: result.cycles.length,
        message: result.message.slice(0, 500),
      },
    })
  }
}

