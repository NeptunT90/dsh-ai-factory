import { describe, expect, it } from 'vitest'
import { createTestRuntime, track } from './helpers.js'

describe('AgentRegistry', () => {
  it('seeds the seven built-in specialists idempotently', () => {
    const { runtime } = track(createTestRuntime())
    const builtins = runtime.agents.list({ enabledOnly: true })
    expect(builtins).toHaveLength(7)
    expect(builtins.map((agent) => agent.role)).toEqual(
      expect.arrayContaining(['director', 'researcher', 'developer', 'sysadmin', 'analyst', 'executor', 'reviewer']),
    )
    runtime.agents.seedBuiltins()
    expect(runtime.agents.count()).toBe(7)
  })

  it('creates, updates and disables a custom profile', () => {
    const { runtime } = track(createTestRuntime())
    const agent = runtime.agents.create({
      name: 'DOCS',
      role: 'custom',
      title: 'Документалист',
      tools: ['read', 'write', 'factory_memory_*'],
      limits: { maxConcurrentTasks: 1, maxAttempts: 2 },
    })
    expect(agent.id).toMatch(/^agt_/)
    expect(agent.enabled).toBe(true)
    expect(agent.limits.maxConcurrentTasks).toBe(1)

    const updated = runtime.agents.update(agent.id, {
      title: 'Технический писатель',
      enabled: false,
      expectedVersion: 1,
    })
    expect(updated.version).toBe(2)
    expect(updated.enabled).toBe(false)
    expect(runtime.agents.findByRole('custom')).toBeUndefined()
  })

  it('rejects duplicate names and disabled task assignment', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const agent = runtime.agents.create({ name: 'UNIQUE', role: 'custom' })
    expect(() => runtime.agents.create({ name: 'UNIQUE', role: 'custom' })).toThrowError(/уже существует/)
    runtime.agents.setEnabled(agent.id, false)
    expect(() =>
      runtime.tasks.create({ projectId, title: 'blocked', assignedAgentId: agent.id }),
    ).toThrowError(/отключён/)
  })
})
