import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolCallId, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import { errorMessage } from '../core/errors.js'
import type { ProbeRequest, ProbeResult, ToolProbeRunner } from './types.js'

/**
 * R0 probes go through the DSH tool batch pipeline, never through
 * ToolDefinition.execute. The pipeline applies pre-execute policy, approvals,
 * the runtime guard and the deployment's timeout wrapper.
 */
export class DshProbeRunner implements ToolProbeRunner {
  constructor(private readonly ctx: Context) {}

  async run(request: ProbeRequest): Promise<ProbeResult> {
    const started = Date.now()
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(Math.max(250, Math.min(10_000, request.timeoutMs ?? 3_000))),
    ])
    const call: ToolCallBlock = {
      type: 'tool-call',
      id: ToolCallId(`health_${randomUUID()}`),
      name: request.tool,
      arguments: JSON.stringify(request.arguments),
    }
    try {
      const batch = await this.ctx.tools.execute({
        calls: [call],
        signal,
        maxParallelToolCalls: 1,
        ...(request.agent === undefined ? {} : { agent: request.agent }),
      })
      const outcome = batch.results[0]?.result
      const latencyMs = Date.now() - started
      if (!outcome) {
        return { ok: false, latencyMs, errorKind: 'NO_RESULT', errorMessage: 'pipeline returned no result' }
      }
      if (outcome.isError) {
        return {
          ok: false,
          latencyMs,
          errorKind: outcome.error.info?.code ?? 'PROBE_ERROR',
          errorMessage: outcome.error.message.slice(0, 500),
        }
      }
      return { ok: true, latencyMs }
    } catch (error) {
      const message = errorMessage(error)
      const code = (error as { code?: unknown }).code
      return {
        ok: false,
        latencyMs: Date.now() - started,
        errorKind: typeof code === 'string' ? code : 'PIPELINE_UNAVAILABLE',
        errorMessage: message.slice(0, 500),
        notRun: true,
        reason: 'pipeline_unavailable',
      }
    }
  }
}
