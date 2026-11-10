import { describe, expect, it } from 'vitest'
import { createTestRuntime, track } from './helpers.js'

describe('TaskEngine', () => {
  it('runs the full lifecycle and promotes dependent tasks', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const first = runtime.tasks.create({ projectId, title: 'Первый шаг', priority: 80 })
    const second = runtime.tasks.create({
      projectId,
      title: 'Второй шаг',
      dependencies: [first.id],
      priority: 90,
    })
    expect(first.status).toBe('READY')
    expect(second.status).toBe('WAITING')

    const claimed = runtime.tasks.claim(first.id, { owner: 'ses_test' })
    expect(claimed.status).toBe('RUNNING')
    expect(claimed.attempts).toBe(1)
    expect(claimed.leaseOwner).toBe('ses_test')

    const heartbeat = runtime.tasks.heartbeat(first.id, 'ses_test', 20 * 60_000)
    expect(heartbeat.leaseUntil).toBeGreaterThan(claimed.leaseUntil ?? 0)

    runtime.tasks.complete(first.id, 'ses_test', 'готово')
    expect(runtime.tasks.require(first.id).status).toBe('COMPLETED')
    expect(runtime.tasks.require(second.id).status).toBe('READY')
    expect(runtime.tasks.events(first.id).some((event) => event.type === 'completed')).toBe(true)
  })

  it('blocks claim while dependencies are incomplete', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const first = runtime.tasks.create({ projectId, title: 'A' })
    const second = runtime.tasks.create({
      projectId,
      title: 'B',
      status: 'READY',
      dependencies: [first.id],
    })
    expect(() => runtime.tasks.claim(second.id, { owner: 'worker' })).toThrowError(/Зависимости/)
  })

  it('retries with bounded attempts and then fails', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'retry', maxAttempts: 2 })
    runtime.tasks.claim(task.id, { owner: 'w1' })
    const retry = runtime.tasks.fail(task.id, 'w1', 'boom')
    expect(retry.status).toBe('READY')
    expect(retry.attempts).toBe(1)
    expect(retry.availableAt).toBeGreaterThan(0)
    runtime.db.run('UPDATE tasks SET available_at = 0 WHERE id = ?', [task.id])
    runtime.tasks.claim(task.id, { owner: 'w1' })
    const failed = runtime.tasks.fail(task.id, 'w1', 'boom again')
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toContain('boom again')
    expect(runtime.tasks.retry(task.id, 'director').status).toBe('READY')
    expect(runtime.tasks.claim(task.id, { owner: 'w1' }).status).toBe('RUNNING')
  })

  it('recovers a task whose lease expired', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'crash recovery' })
    runtime.tasks.claim(task.id, { owner: 'dead-worker' })
    runtime.db.run('UPDATE tasks SET lease_until = 1 WHERE id = ?', [task.id])
    expect(runtime.tasks.recoverStale()).toBe(1)
    const recovered = runtime.tasks.require(task.id)
    expect(recovered.status).toBe('READY')
    expect(recovered.error).toContain('lease expired')
    expect(runtime.tasks.events(task.id).some((event) => event.type === 'lease_expired')).toBe(true)
  })

  it('enforces an agent concurrency limit', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const agent = runtime.agents.create({
      name: 'SINGLE',
      role: 'executor',
      limits: { maxConcurrentTasks: 1 },
    })
    const a = runtime.tasks.create({ projectId, title: 'a', assignedAgentId: agent.id })
    const b = runtime.tasks.create({ projectId, title: 'b', assignedAgentId: agent.id })
    runtime.tasks.claim(a.id, { owner: 'w1' })
    expect(() => runtime.tasks.claim(b.id, { owner: 'w1' })).toThrowError(/лимит/)
  })

  it('reports stats and rejects terminal edits', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const task = runtime.tasks.create({ projectId, title: 'stats' })
    runtime.tasks.claim(task.id, { owner: 'w1' })
    runtime.tasks.complete(task.id, 'w1')
    const stats = runtime.tasks.stats(projectId)
    expect(stats.completed).toBe(1)
    expect(stats.active).toBe(0)
    expect(() => runtime.tasks.update(task.id, { title: 'nope' })).toThrowError(/терминальном/)
  })
})
