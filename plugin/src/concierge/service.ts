import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { errorMessage } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'

interface SessionLike {
  readonly id: string
  readonly header?: {
    readonly cwd?: string
    readonly parentSession?: string | null
    readonly origin?: string
  }
  snapshotEvents?(): Array<{ type: string; data?: unknown }>
  append?(type: string, data: unknown, options?: unknown): unknown
}

interface AgentLike {
  readonly id: string
  readonly status: string
  readonly session: SessionLike
  readonly inbox?: {
    remove(id: string): boolean
    prepend?(target: 'next-turn' | 'next-step', message: UserMessageLike): void
  }
}

interface UserMessageLike {
  id?: string
  content?: Array<{ type?: string; text?: string }>
  source?: { kind?: string }
}

type ConciergeIntent =
  | { readonly kind: 'status' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'explicit'; readonly body: string }
  | { readonly kind: 'work' }
  | { readonly kind: 'ambiguous' }

const STATUS_QUERY = /^(?:как\s+дела|как\s+ты|что\s+там|что\s+происходит|статус|отч[её]т|how\s+are\s+you)[\s?!.]*$/iu
const STOP_COMMAND = /^(?:стоп|stop|останови|отмени|cancel)[\s!.]*$/iu
const WORK_MARKER = /(?:напиши|сделай|исправь|python|файл|создай|удали|запусти|проверь|найди|реализуй|переделай|добавь|тест|git|код|проект|ошибк|открой|посмотри|покажи|объясни|настрой|почини)/iu
const EXPLICIT_PREFIX = /^\/(?:concierge|секретарь)(?:\s+|$)/iu

function textOf(message: UserMessageLike): string {
  return (message.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n')
    .trim()
}

function intentOf(raw: string): ConciergeIntent {
  const text = raw.trim().replace(/\s+/g, ' ')
  const explicit = EXPLICIT_PREFIX.exec(text)
  if (explicit) {
    const body = text.slice(explicit[0].length).trim()
    return { kind: 'explicit', body }
  }
  if (text.length > 160) return { kind: 'ambiguous' }
  if (WORK_MARKER.test(text)) return { kind: 'work' }
  if (STOP_COMMAND.test(text)) return { kind: 'stop' }
  if (STATUS_QUERY.test(text)) return { kind: 'status' }
  return { kind: 'ambiguous' }
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
 * Independent in-process CONCIERGE router.
 *
 * It observes the durable inbox splice that is written before DSH claims a
 * queued prompt. Only the root DIRECTOR session is eligible, only while it is
 * running, and only for a strict status/stop/explicit intent. The message is
 * removed only when the inbox still owns it; a lost race is never answered.
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
      if (event.type !== 'agent/inbox/spliced') return
      if (session.header?.parentSession !== null && session.header?.parentSession !== undefined) return
      if (session.header?.origin === 'subagent') return
      const data = (event.data ?? {}) as { target?: string; inserted?: UserMessageLike[] }
      if (data.target !== 'next-turn') return
      const agent = this.agentFor(session)
      if (!agent || agent.status !== 'running' || !agent.inbox) {
        this.auditSkipped(session, agent, 'agent_not_running')
        return
      }
      for (const message of data.inserted ?? []) {
        if (message.source?.kind !== undefined && message.source.kind !== 'user') continue
        const text = textOf(message)
        if (text === '') continue
        const intent = intentOf(text)
        if (intent.kind === 'work' || intent.kind === 'ambiguous') {
          this.auditSkipped(session, agent, 'intent')
          continue
        }
        if (message.id === undefined) {
          this.auditSkipped(session, agent, 'missing_id')
          continue
        }
        let removed = false
        try {
          removed = agent.inbox.remove(message.id)
        } catch (error) {
          this.audit(session, 'concierge.failed', 'warn', { reason: errorMessage(error), stage: 'remove' })
          continue
        }
        if (!removed) {
          this.audit(session, 'concierge.race_lost', 'warn', { intent: intent.kind })
          continue
        }
        this.audit(session, 'concierge.intercepted', 'info', { intent: intent.kind })
        const reply = this.replyFor(session, intent)
        if (reply === undefined) {
          this.audit(session, 'concierge.failed', 'warn', { reason: 'no_reply', stage: 'reply' })
          continue
        }
        if (!this.appendReply(session, reply)) {
          try { agent.inbox.prepend?.('next-turn', message) } catch { /* best effort restore */ }
          this.audit(session, 'concierge.failed', 'warn', { reason: 'append_unavailable', stage: 'reply' })
          continue
        }
        this.audit(session, 'concierge.replied', 'info', { intent: intent.kind })
      }
    } catch (error) {
      this.runtime.audit.record({
        event: 'concierge.failed',
        level: 'warn',
        data: { reason: errorMessage(error) },
      })
    }
  }

  private replyFor(session: SessionLike, intent: ConciergeIntent): string | undefined {
    const project = this.runtime.projects.ensure(session.header?.cwd?.trim() || process.cwd())
    const tasks = this.runtime.tasks.list({ projectId: project.id, includeTerminal: false, limit: 50 })
    const running = tasks.filter((task) => task.status === 'RUNNING')
    const waiting = tasks.filter((task) => task.status === 'READY' || task.status === 'WAITING')

    if (intent.kind === 'stop') {
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
      return stopped.length > 0
        ? `Останавливаю: ${stopped.join('; ')}.`
        : 'Активной задачи для остановки сейчас нет.'
    }

    if (intent.kind === 'explicit') {
      if (STOP_COMMAND.test(intent.body)) return this.replyFor(session, { kind: 'stop' })
      if (STATUS_QUERY.test(intent.body)) return this.replyFor(session, { kind: 'status' })
      if (intent.body !== '') {
        return [
          'Секретарь на связи.',
          'Доступны: «статус» / «как дела?» и «стоп».',
          'Рабочие задачи остаются DIRECTOR.',
        ].join('\n')
      }
    }

    if (running.length === 0 && waiting.length === 0) return 'Сейчас активных и ожидающих задач нет.'
    return [
      `Сейчас в работе: ${running.length}; в очереди: ${waiting.length}.`,
      ...running.slice(0, 3).map((task) => `- RUNNING: ${task.title}`),
      ...waiting.slice(0, 3).map((task) => `- ${task.status}: ${task.title}`),
    ].join('\n')
  }

  private appendReply(session: SessionLike, text: string): boolean {
    if (!session.append) return false
    const { turn, step } = lastTurn(session)
    try {
      session.append('assistant/message', {
        turn,
        step,
        message: createAssistantMessage({
          content: [{ type: 'text', text }],
          source: { provider: 'factory', model: 'concierge' },
        }),
        stream: [],
      }, { surfaceOp: 'append' })
      return true
    } catch {
      return false
    }
  }

  private auditor(session: SessionLike): { projectId: string; sessionId: string } {
    const project = this.runtime.projects.ensure(session.header?.cwd?.trim() || process.cwd())
    return { projectId: project.id, sessionId: session.id }
  }

  private audit(session: SessionLike, event: string, level: 'info' | 'warn', data: Record<string, unknown>): void {
    const ids = this.auditor(session)
    this.runtime.audit.record({
      event,
      level,
      actor: 'agt_concierge',
      projectId: ids.projectId,
      sessionId: ids.sessionId,
      data,
    })
  }

  private auditSkipped(session: SessionLike, agent: AgentLike | undefined, reason: string): void {
    this.audit(session, 'concierge.skipped', 'info', {
      reason,
      status: agent?.status ?? 'missing',
    })
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
}
