import { createAssistantMessage } from '@deepseek-ai/dsh-llm'

export interface VisibleSession {
  snapshotEvents?(): Array<{ type: string; data?: unknown }>
  append?(type: string, data: unknown, options?: unknown): unknown
}

function lastTurn(session: VisibleSession): number {
  let turn = 0
  for (const event of session.snapshotEvents?.() ?? []) {
    if (event.type !== 'turn/start') continue
    const value = Number((event.data as { turn?: number } | undefined)?.turn)
    if (Number.isFinite(value) && value > turn) turn = value
  }
  return turn
}

/**
 * Publish a visible assistant message while the agent is idle.
 *
 * DSH Web renders assistant messages inside a turn-local conversation
 * projection. A bare `assistant/message` appended outside `turn/start` ..
 * `turn/end` is durable but not shown in chat. This helper creates a synthetic
 * completed turn around the message so the normal UI channel renders it.
 *
 * This is display-only: no model request is made and the agent loop is not
 * woken. The next real user input starts its own turn after this one.
 */
export function appendVisibleAssistant(session: VisibleSession, text: string): boolean {
  if (!session.append) return false
  const turn = lastTurn(session) + 1
  const step = 1
  try {
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step })
    session.append('assistant/message', {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'factory', model: 'notification' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
    return true
  } catch {
    return false
  }
}
