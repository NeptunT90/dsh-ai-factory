import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ConciergeService } from '../src/concierge/service.js'
import { createTestRuntime, track } from './helpers.js'

interface FakeMessage {
  id: string
  content: Array<{ type: string; text: string }>
  source: { kind: string }
}

function fakeSession(projectRoot: string) {
  const appended: Array<{ type: string; data: unknown; options: unknown }> = []
  const removed: string[] = []
  const session = {
    id: 'ses_root',
    header: { cwd: projectRoot },
    snapshotEvents() {
      return [
        { type: 'turn/start', data: { turn: 4 } },
        { type: 'step/start', data: { turn: 4, step: 2 } },
      ]
    },
    append(type: string, data: unknown, options: unknown) {
      appended.push({ type, data, options })
      return 1
    },
    inbox: { remove(id: string) { removed.push(id); return true } },
  }
  return { session, appended, removed }
}

function serviceFor(runtime: ReturnType<typeof createTestRuntime>['runtime'], agent: unknown): ConciergeService {
  const ctx = {
    get(name: string) {
      if (name !== 'agents') return undefined
      return { get: (id: string) => (id === (agent as { id: string }).id ? agent : undefined) }
    },
    on() {
      return () => {}
    },
  } as unknown as Context
  return new ConciergeService(ctx, runtime)
}

function userEvent(text: string, id = 'msg_user_1'): { type: string; data: FakeMessage } {
  return { type: 'user/message', data: { id, content: [{ type: 'text', text }], source: { kind: 'user' } } }
}

describe('CONCIERGE async chat', () => {
  it('answers a status question while the root agent is busy and removes the queued message', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Run long tests' })
    runtime.tasks.claim(task.id, { owner: 'ses_other', leaseMs: 60_000 })
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handle(fake.session, userEvent('Как дела?'))
    expect(fake.appended).toHaveLength(1)
    const appended = fake.appended[0]!
    expect(appended.type).toBe('assistant/message')
    expect(appended.options).toEqual({ surfaceOp: 'append' })
    expect(JSON.stringify(appended.data)).toContain('RUNNING')
    expect(fake.removed).toEqual(['msg_user_1'])
  })

  it('cancels a RUNNING task on a stop command', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Long task' })
    runtime.tasks.claim(task.id, { owner: 'ses_other', leaseMs: 60_000 })
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handle(fake.session, userEvent('Стоп'))
    expect(runtime.tasks.require(task.id).status).toBe('CANCELLED')
    expect(fake.appended).toHaveLength(1)
    expect(JSON.stringify(fake.appended[0]!.data)).toContain('Останавливаю')
  })

  it('does not intercept a normal work message or a non-running agent', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const fake = fakeSession(project.rootPath)
    const busy = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, busy).handle(fake.session, userEvent('Сделай рефакторинг модуля'))
    expect(fake.appended).toHaveLength(0)
    const idle = { ...busy, status: 'idle' }
    serviceFor(runtime, idle).handle(fake.session, userEvent('Как дела?'))
    expect(fake.appended).toHaveLength(0)
  })
})
