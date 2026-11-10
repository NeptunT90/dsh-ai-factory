import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { FactoryError, errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import type { AgentProfile } from './types.js'

export interface ScopedRunInput {
  readonly parent: Agent
  readonly cwd: string
  readonly prompt: string
  readonly profile: AgentProfile
  readonly signal: AbortSignal
  readonly label?: string
  readonly timeoutMs?: number
}

export interface ChildRunner {
  run(input: ScopedRunInput): Promise<ScopedRunResult>
}

export interface ScopedRunResult {
  readonly childId: string
  readonly output: string
  readonly stopReason: 'completed' | 'error' | 'aborted'
  readonly diagnostic: string
}

function textFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter((text) => text !== '')
    .join('\n')
    .trim()
}

function modelOptions(profile: AgentProfile): AgentOptions | undefined {
  if (!profile.modelProvider || !profile.model) return undefined
  const options: AgentOptions = { provider: profile.modelProvider, model: profile.model }
  if (profile.reasoningEffort) {
    options.reasoningEffort = profile.reasoningEffort as AgentOptions['reasoningEffort']
  }
  return options
}

/**
 * Child runner that owns the agent directly instead of delegating to
 * ctx.subagents. This is required for scoped enforcement: setup() runs before
 * publication, so the child's registry tools are restricted and the runtime
 * guard has the exact allowlist before the first model call.
 */
export class ScopedChildRunner implements ChildRunner {
  constructor(
    private readonly ctx: Context,
    private readonly runtime: FactoryRuntime,
  ) {}

  async run(input: ScopedRunInput): Promise<ScopedRunResult> {
    const agents = this.ctx.get('agents') as AgentRegistry | undefined
    if (!agents) {
      throw new FactoryError('UNAVAILABLE', 'ctx.agents недоступен; кастомный scoped runner не может создать ребёнка')
    }
    const allowed = input.profile.allowedTools
    if (allowed.length === 0) {
      throw new FactoryError('FORBIDDEN', `Профиль ${input.profile.name} не имеет allowedTools; запуск запрещён`)
    }
    const sessionId = `ses_${randomUUID()}` as SessionId
    const timeoutMs = Math.max(1000, Math.min(2 * 60 * 60 * 1000, input.timeoutMs ?? 30 * 60_000))
    let handle: Awaited<ReturnType<AgentRegistry['create']>> | undefined
    let childId = ''
    let timedOut = false
    let initialSeq = 0
    try {
      const options =
        modelOptions(input.profile) ??
        (input.parent.options?.provider && input.parent.options?.model
          ? {
              provider: input.parent.options.provider,
              model: input.parent.options.model,
              ...(input.parent.options.reasoningEffort
                ? { reasoningEffort: input.parent.options.reasoningEffort }
                : {}),
            }
          : undefined)
      handle = await agents.create({
        sessionId,
        parentAgent: input.parent,
        meta: { cwd: input.cwd, origin: 'subagent', delegationDepth: 1 },
        ...(options === undefined ? {} : { agentOptions: options }),
        setup: (agentCtx) => {
          const known = agentCtx.tools.definitions().map((definition) => definition.name)
          // Factory tools stay visible so a forbidden call reaches the guard and
          // returns the explicit TOOL_NOT_ALLOWED error; non-factory host tools
          // are hidden from the schema as well.
          const deny = known.filter((name) => !allowed.includes(name) && !name.startsWith('factory_'))
          if (deny.length > 0) agentCtx.tools.restrict({ deny })
        },
      })
      childId = handle.agent.id
      this.runtime.allowToolsForChild(childId, allowed)

      if (input.signal.aborted) {
        throw new FactoryError('UNAVAILABLE', 'Родительская операция отменена до запуска ребёнка')
      }
      const onAbort = (): void => handle?.agent.cancel({ kind: 'user' })
      input.signal.addEventListener('abort', onAbort, { once: true })
      try {
        initialSeq = handle.agent.session.seq
        handle.agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: input.prompt }],
            source: { kind: 'user' },
          }),
        )
        // followup() is asynchronous: whenIdle() can resolve before the driver
        // claims the turn, so wait until the turn is observable, then drain it.
        const startDeadline = Date.now() + 10_000
        while (Date.now() < startDeadline) {
          const events = handle.agent.session.snapshotEvents()
          const started = handle.agent.status === 'running' || events.some(
            (event) => event.type === 'turn/start' || event.type === 'assistant/message',
          )
          if (started) break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        let timeout: ReturnType<typeof setTimeout> | undefined
        const timed = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true
            handle?.agent.cancel({ kind: 'user' })
            reject(new Error(`child timeout after ${timeoutMs}ms`))
          }, timeoutMs)
          timeout.unref?.()
        })
        try {
          await Promise.race([handle.agent.whenIdle(), timed])
        } finally {
          if (timeout) clearTimeout(timeout)
        }
      } finally {
        input.signal.removeEventListener('abort', onAbort)
      }

      const events = handle.agent.session.snapshotEvents()
      let output = ''
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event?.type !== 'assistant/message') continue
        output = textFromBlocks(event.data.message.content)
        if (output !== '') break
      }
      if (output === '') {
        const tail = JSON.stringify(
          handle.agent.session.snapshotEvents().slice(-10).map((event) => ({
            type: event.type,
            data: (event as { data?: unknown }).data,
          })),
        ).slice(0, 4000)
        return {
          childId,
          output: '',
          stopReason: 'error',
          diagnostic: timedOut
            ? 'child timeout'
            : `ребёнок завершил ход без текстового ответа (seq ${initialSeq}); events: ${tail}`,
        }
      }
      return { childId, output, stopReason: 'completed', diagnostic: '' }
    } catch (error) {
      return {
        childId,
        output: '',
        stopReason: input.signal.aborted ? 'aborted' : 'error',
        diagnostic: errorMessage(error),
      }
    } finally {
      if (childId !== '') this.runtime.releaseChildTools(childId)
      if (handle) {
        try {
          await handle.dispose()
        } catch {
          // result remains authoritative
        }
      }
    }
  }
}
