import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'

interface SessionLike {
  readonly id: string
  readonly header?: { readonly cwd?: string }
  snapshotEvents?(): Array<{ type: string; data?: unknown }>
  append?(type: string, data: unknown, options?: unknown): unknown
}

interface AgentLike {
  readonly id: string
  readonly status: string
  readonly session: SessionLike
  readonly inbox?: { remove(id: string): boolean }
}

interface UserMessageLike {
  id?: string
  content?: Array<{ type?: string; text?: string }>
  source?: { kind?: string }
}

const STATUS_QUERY = /(?:как\s+дела|что\s+(?:там|происходит|с\s+задачами)|статус|отч[её]т|how\s+are\s+you|status)/i
const STOP_COMMAND = /(?:^|\b)(?:стоп|stop|отмени|отмена|cancel|останови)/i

function textOf(message: UserMessageLike): string {
  return (message.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n')
    .trim()
}

function lastTurn(session: SessionLike): { turn: number; step: number } {
  let turn = 0
  let step = 0
  for (const event of session.snapshotEvents?.() ?? []) {
    if (event.type === 'turn/start') {
      const value = Number((event.data as { turn?: number } | undefined)?.turn)
      if (Number.isFinite(value)) turn = value
    }
    if (event.type === 'step/start') {
      const value = Number((event.data as { step?: number } | undefined)?.step)
      if (Number.isFinite(value)) step = value
    }
  }
  return { turn, step }
}

/**
 * Deterministic CONCIERGE listener for a busy root agent.
 *
 * DSH exposes `session/event`, `agent/inbox` and `session.append`, so a host
 * plugin can observe a queued user message and append a status reply without
 * waiting for the running turn. This listener only answers status questions and
 * stop/cancel commands; normal work instructions remain in the normal queue.
 */
export class ConciergeService {
  private disposeListener: (() => void) | undefined

  constructor(
    private readonly ctx: Context,
    private readonly runtime: FactoryRuntime,
  ) {}

  start(): void {
    const on = (this.ctx as unknown as { on?: (event: string, listener: (session: SessionLike, event: { type: string; data?: unknown }) => void) => () => void }).on
    if (!on) return
    this.disposeListener = on.call(this.ctx, 'session/event', (session, event) => {
      this.handle(session, event)
    })
  }

  dispose(): void {
    this.disposeListener?.()
    this.disposeListener = undefined
  }

  /** Public for focused tests and host adapters. */
  handle(session: SessionLike, event: { type: string; data?: unknown }): void {
    try {
      if (event.type !== 'user/message') return
      const message = (event.data ?? {}) as UserMessageLike
      if (message.source?.kind !== undefined && message.source.kind !== 'user') return
      const text = textOf(message)
      if (text === '') return
      const agent = this.agentFor(session)
      if (!agent || agent.status !== 'running') return
      const stop = STOP_COMMAND.test(text)
      if (!stop && !STATUS_QUERY.test(text)) return

      const root = session.header?.cwd?.trim() || process.cwd()
      const project = this.runtime.projects.ensure(root)
      const tasks = this.runtime.tasks.list({ projectId: project.id, includeTerminal: false, limit: 50 })
      const running = tasks.filter((task) => task.status === 'RUNNING')
      const waiting = tasks.filter((task) => task.status === 'READY' || task.status === 'WAITING')
      let reply: string
      if (stop) {
        const stopped: string[] = []
        for (const task of running.slice(0, 5)) {
          const delivered = this.runtime.followupActiveTask(task.id, 'Стоп: пользователь просит остановить работу.')
          if (delivered) {
            stopped.push(`${task.title} (followup)`)
            continue
          }
          try {
            this.runtime.tasks.cancel(task.id, 'agt_concierge', 'user requested stop')
            stopped.push(`${task.title} (cancelled)`)
          } catch {
            stopped.push(`${task.title} (не удалось остановить)`)
          }
        }
        reply = stopped.length > 0
          ? `Останавливаю: ${stopped.join('; ')}.`
          : 'Активной задачи для остановки сейчас нет.'
      } else if (running.length === 0 && waiting.length === 0) {
        reply = 'Сейчас активных и ожидающих задач нет.'
      } else {
        const lines = [
          `Сейчас в работе: ${running.length}; в очереди: ${waiting.length}.`,
          ...running.slice(0, 3).map((task) => `- RUNNING: ${task.title}`),
          ...waiting.slice(0, 3).map((task) => `- ${task.status}: ${task.title}`),
        ]
        reply = lines.join('\n')
      }

      this.appendReply(session, reply)
      if (message.id !== undefined && agent.inbox) {
        try { agent.inbox.remove(message.id) } catch { /* message may already be claimed */ }
      }
      this.runtime.audit.record({
        event: 'concierge.replied',
        level: 'info',
        actor: 'agt_concierge',
        projectId: project.id,
        sessionId: session.id,
        data: { channel: 'assistant/message', running: running.length, waiting: waiting.length, stop },
      })
    } catch (error) {
      this.runtime.audit.record({
        event: 'concierge.failed',
        level: 'warn',
        data: { reason: errorMessage(error) },
      })
    }
  }

  private agentFor(session: SessionLike): AgentLike | undefined {
    try {
      const registry = (this.ctx as unknown as { get?: (name: string) => unknown }).get?.('agents') as
        | { get?: (id: string) => unknown }
        | undefined
      const value = registry?.get?.(session.id)
      if (!value || typeof value !== 'object') return undefined
      return value as AgentLike
    } catch {
      return undefined
    }
  }

  private appendReply(session: SessionLike, text: string): void {
    if (!session.append) return
    const { turn, step } = lastTurn(session)
    session.append('assistant/message', {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'factory', model: 'concierge' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
  }
}
