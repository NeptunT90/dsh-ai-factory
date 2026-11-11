import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ConciergeService } from '../src/concierge/service.js'
import { createTestRuntime, track } from './helpers.js'

interface FakeMessage {
  id: string
  content: Array<{ type: string; text: string }>
  source: { kind: string }
}

function fakeSession(projectRoot: string, options: { parentSession?: string | null; noAppend?: boolean; removeResult?: boolean } = {}) {
  const appended: Array<{ type: string; data: unknown; options: unknown }> = []
  const removed: string[] = []
  const prepended: string[] = []
  const session = {
    id: 'ses_root',
    header: { cwd: projectRoot, parentSession: options.parentSession === undefined ? null : options.parentSession },
    snapshotEvents() {
      return [
        { type: 'turn/start', data: { turn: 4 } },
        { type: 'step/start', data: { turn: 4, step: 2 } },
      ]
    },
    ...(options.noAppend ? {} : {
      append(type: string, data: unknown, opts: unknown) {
        appended.push({ type, data, options: opts })
        return appended.length
      },
    }),
    inbox: {
      remove(id: string) {
        removed.push(id)
        return options.removeResult !== false
      },
      prepend(_target: string, value: { id: string }) {
        prepended.push(value.id)
      },
    },
  }
  return { session, appended, removed, prepended }
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

function message(text: string, id = 'msg_user_1'): FakeMessage {
  return { id, content: [{ type: 'text', text }], source: { kind: 'user' } }
}

describe('CONCIERGE v2 async inbox', () => {
  it('answers a status query while DIRECTOR is running and removes the inbox message', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Run long tests' })
    runtime.tasks.claim(task.id, { owner: 'ses_other', leaseMs: 60_000 })
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Как дела?') })
    expect(fake.removed).toEqual(['msg_user_1'])
    expect(fake.appended).toHaveLength(1)
    expect(fake.appended[0]!.type).toBe('assistant/message')
    expect(fake.appended[0]!.options).toEqual({ surfaceOp: 'append' })
    expect(JSON.stringify(fake.appended[0]!.data)).toContain('RUNNING')
  })

  it('leaves the message to DIRECTOR when it is idle', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'idle', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Как дела?') })
    expect(fake.removed).toEqual([])
    expect(fake.appended).toHaveLength(0)
  })

  it('intercepts a root message while a background task is RUNNING even if DIRECTOR is idle', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Фоновая статья' })
    runtime.tasks.claim(task.id, { owner: 'ses_bg', leaseMs: 60_000 })
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'idle', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Как дела?') })
    expect(fake.removed).toEqual(['msg_user_1'])
    expect(fake.appended).toHaveLength(1)
    expect(JSON.stringify(fake.appended[0]!.data)).toContain('RUNNING')
  })

  it('does not intercept work commands', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Напиши код на Python') })
    expect(fake.removed).toEqual([])
    expect(fake.appended).toHaveLength(0)
    expect(runtime.audit.recent(10).some((record) => record.event === 'concierge.skipped')).toBe(true)
  })

  it('does not answer a lost claim race', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const fake = fakeSession(project.rootPath, { removeResult: false })
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Статус') })
    expect(fake.removed).toEqual(['msg_user_1'])
    expect(fake.appended).toHaveLength(0)
    expect(runtime.audit.recent(10).some((record) => record.event === 'concierge.race_lost')).toBe(true)
  })

  it('does not intercept a child session', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const fake = fakeSession(project.rootPath, { parentSession: 'ses_parent' })
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Статус') })
    expect(fake.removed).toEqual([])
    expect(fake.appended).toHaveLength(0)
  })

  it('always intercepts the explicit /concierge channel', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('/concierge напиши код') })
    expect(fake.removed).toEqual(['msg_user_1'])
    expect(fake.appended).toHaveLength(1)
    expect(JSON.stringify(fake.appended[0]!.data)).toContain('Секретарь на связи')
  })

  it('cancels a RUNNING task on an exact stop command', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const task = runtime.tasks.create({ projectId, title: 'Long task' })
    runtime.tasks.claim(task.id, { owner: 'ses_other', leaseMs: 60_000 })
    const fake = fakeSession(project.rootPath)
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Стоп') })
    expect(runtime.tasks.require(task.id).status).toBe('CANCELLED')
    expect(fake.removed).toEqual(['msg_user_1'])
    expect(fake.appended).toHaveLength(1)
    expect(JSON.stringify(fake.appended[0]!.data)).toContain('Останавливаю')
  })

  it('keeps the inbox message when append is unavailable', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const fake = fakeSession(project.rootPath, { noAppend: true })
    const agent = { id: 'ses_root', status: 'running', session: fake.session, inbox: fake.session.inbox }
    serviceFor(runtime, agent).handleInserted(agent, { message: message('Как дела?') })
    expect(fake.removed).toEqual(['msg_user_1'])
    expect(fake.prepended).toEqual(['msg_user_1'])
    expect(runtime.audit.recent(10).some((record) => record.event === 'concierge.failed')).toBe(true)
  })
})
