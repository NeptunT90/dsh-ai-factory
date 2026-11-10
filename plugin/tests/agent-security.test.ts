import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../src/core/errors.js'
import type { FactoryRuntime } from '../src/runtime.js'
import { registerAgentTools } from '../src/agents/tools.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_agent_save',
    name: 'factory_agent_save',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: agentId,
      session: { header: { cwd } },
    },
  } as unknown as ToolRunContext
}

function agentTools(
  runtime: FactoryRuntime,
  callerTools: readonly string[],
): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      definitions() {
        return callerTools.map((name) => ({ name, description: name }))
      },
    },
  } as unknown as Context
  registerAgentTools(ctx, () => runtime, () => undefined)
  return tools
}

function agentSaveTool(runtime: FactoryRuntime, callerTools: readonly string[]): ToolDefinition {
  const tool = agentTools(runtime, callerTools).get('factory_agent_save')
  if (!tool) throw new Error('factory_agent_save not registered')
  return tool
}

function mismatch(promise: Promise<unknown>): Promise<unknown> {
  return expect(promise).rejects.toMatchObject({ code: 'FORBIDDEN' })
}

describe('factory_agent_save privilege boundary', () => {
  it('allows a root caller to grant a subset of its visible tools', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const tool = agentSaveTool(runtime, ['read', 'write', 'factory_status'])
    const result = (await tool.execute(
      { name: 'SAFE_AGENT', role: 'custom', allowedTools: ['read'] },
      fakeExec('ses_root', runtime.projects.require(projectId).rootPath),
    )) as { name: string; allowedTools: string[] }

    expect(result.name).toBe('SAFE_AGENT')
    expect(result.allowedTools).toEqual(['read'])
    expect(runtime.audit.recent(20).some((entry) => entry.event === 'agent.created')).toBe(true)
  })

  it('rejects a child caller even when it has factory_agent_save in its allowlist', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const tool = agentSaveTool(runtime, ['read', 'factory_agent_save'])
    runtime.allowToolsForChild('ses_child', ['read', 'factory_agent_save'])

    await mismatch(
      tool.execute(
        { name: 'CHILD_ESCALATION', role: 'custom', allowedTools: ['read'] },
        fakeExec('ses_child', runtime.projects.require(projectId).rootPath),
      ),
    )
    expect(runtime.agents.list({ limit: 200 }).some((agent) => agent.name === 'CHILD_ESCALATION')).toBe(false)
    const denied = runtime.audit.recent(20).find((entry) => entry.event === 'agent.grant_denied')
    expect(denied?.data.reason).toBe('child_forbidden')
  })

  it('rejects a root caller granting a tool it cannot see', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const tool = agentSaveTool(runtime, ['read'])

    await mismatch(
      tool.execute(
        { name: 'ESCALATED_AGENT', role: 'custom', allowedTools: ['read', 'factory_dispatch'] },
        fakeExec('ses_root', runtime.projects.require(projectId).rootPath),
      ),
    )
    expect(runtime.agents.list({ limit: 200 }).some((agent) => agent.name === 'ESCALATED_AGENT')).toBe(false)
    const denied = runtime.audit.recent(20).find((entry) => entry.event === 'agent.grant_denied')
    expect(denied?.data.reason).toBe('caller_subset')
    expect(denied?.data.missingAllowedTools).toEqual(['factory_dispatch'])
  })

  it('does not allow an update to widen an existing profile', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const existing = runtime.agents.create({ name: 'EXISTING', role: 'custom', allowedTools: ['read'] })
    const tool = agentSaveTool(runtime, ['read'])

    await mismatch(
      tool.execute(
        { id: existing.id, allowedTools: ['read', 'pwsh'] },
        fakeExec('ses_root', runtime.projects.require(projectId).rootPath),
      ),
    )
    expect(runtime.agents.require(existing.id).allowedTools).toEqual(['read'])
  })

  it('leaves allowedTools untouched when the field is omitted', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const existing = runtime.agents.create({ name: 'NO_CHANGE', role: 'custom', allowedTools: ['read'] })
    const tool = agentSaveTool(runtime, [])

    const result = (await tool.execute(
      { id: existing.id, title: 'Updated title' },
      fakeExec('ses_root', runtime.projects.require(projectId).rootPath),
    )) as { title: string; allowedTools: string[] }
    expect(result.title).toBe('Updated title')
    expect(result.allowedTools).toEqual(['read'])
  })

  it('refuses to modify or disable a built-in profile', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const tools = agentTools(runtime, ['read'])
    const save = tools.get('factory_agent_save')!
    const toggle = tools.get('factory_agent_toggle')!
    const exec = fakeExec('ses_root', runtime.projects.require(projectId).rootPath)
    const director = runtime.agents.require('agt_director')
    const before = director.systemInstruction

    await mismatch(save.execute({ id: director.id, systemInstruction: 'overridden' }, exec))
    await mismatch(toggle.execute({ id: director.id, enabled: false }, exec))
    expect(runtime.agents.require(director.id).systemInstruction).toBe(before)
    expect(runtime.agents.require(director.id).enabled).toBe(true)
    expect(runtime.audit.recent(20).filter((entry) => entry.event === 'agent.grant_denied').some((entry) => entry.data.reason === 'builtin_protected')).toBe(true)
  })

  it('refuses a caller with a lower access level than the target', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const tools = agentTools(runtime, ['read'])
    const save = tools.get('factory_agent_save')!
    const toggle = tools.get('factory_agent_toggle')!
    const exec = fakeExec('ses_root', runtime.projects.require(projectId).rootPath)
    const target = runtime.agents.create({ name: 'HIGH_ACCESS', role: 'custom', accessLevel: 'elevated' })
    const level = vi.spyOn(runtime, 'agentAccessLevel').mockReturnValue('workspace')

    await mismatch(save.execute({ id: target.id, title: 'lowered' }, exec))
    await mismatch(toggle.execute({ id: target.id, enabled: false }, exec))
    await mismatch(save.execute({ name: 'TOO_HIGH', role: 'custom', accessLevel: 'elevated' }, exec))
    expect(runtime.agents.require(target.id).title).toBe('HIGH_ACCESS')
    expect(runtime.agents.require(target.id).enabled).toBe(true)
    expect(runtime.audit.recent(20).filter((entry) => entry.event === 'agent.grant_denied').some((entry) => entry.data.reason === 'access_level_higher')).toBe(true)
    level.mockRestore()
  })

  it('fails closed when the caller tool set cannot be resolved', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const tool = agentSaveTool(runtime, [])
    const exec = {
      ...fakeExec('ses_root', runtime.projects.require(projectId).rootPath),
      agent: undefined,
    } as unknown as ToolRunContext
    await expect(
      tool.execute({ name: 'NO_CALLER', role: 'custom', allowedTools: ['read'] }, exec),
    ).rejects.toBeInstanceOf(FactoryError)
  })
})
