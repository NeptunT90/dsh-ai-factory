import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { FactoryRuntime } from '../src/runtime.js'
import { registerAgentTools } from '../src/agents/tools.js'
import { TOOL_HEALTH_SPECS } from '../src/health/registry.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_marketplace',
    name: 'factory_agent_export',
    arguments: {},
    signal: new AbortController().signal,
    agent: { id: agentId, session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

function toolsFor(runtime: FactoryRuntime, callerTools: readonly string[] = ['read']): Map<string, ToolDefinition> {
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

function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code })
}

describe('agent marketplace', () => {
  it('exports a portable profile and imports it into a clean runtime', async () => {
    const first = track(createTestRuntime())
    const second = track(createTestRuntime())
    const projectRoot = join(first.dir, 'market')
    first.runtime.projects.ensure(projectRoot, 'Market')
    second.runtime.projects.ensure(projectRoot, 'Market')
    const source = first.runtime.agents.create({
      name: 'Market Agent',
      role: 'reviewer',
      title: 'Market reviewer',
      description: 'Portable reviewer profile',
      systemInstruction: 'Review carefully.',
      allowedTools: ['read'],
    })
    const exportTools = toolsFor(first.runtime)
    const root1 = fakeExec('ses_root', projectRoot)
    const exported = (await exportTools.get('factory_agent_export')!.execute(
      { agentId: source.id },
      root1,
    )) as { marketplaceId: string; relativePath: string; hash: string }
    expect(exported.marketplaceId).toBe('market-agent')
    const filePath = join(projectRoot, '.agents', 'market-agent.json')
    expect(existsSync(filePath)).toBe(true)
    const raw = readFileSync(filePath, 'utf8')
    expect(raw).not.toContain(source.id)
    expect(raw).not.toContain('isBuiltin')
    expect(raw).not.toContain('createdAt')

    const validateTools = toolsFor(second.runtime, ['read', 'factory_agent_import'])
    const root2 = fakeExec('ses_root', projectRoot)
    const valid = (await validateTools.get('factory_agent_validate')!.execute(
      { fileId: 'market-agent' },
      root2,
    )) as { valid: boolean; marketplaceId: string }
    expect(valid.valid).toBe(true)
    expect(valid.marketplaceId).toBe('market-agent')

    const imported = (await validateTools.get('factory_agent_import')!.execute(
      { fileId: 'market-agent' },
      root2,
    )) as { id: string; name: string; allowedTools: string[] }
    expect(imported.id).not.toBe(source.id)
    expect(imported.name).toBe('Market Agent')
    expect(imported.allowedTools).toEqual(['read'])
    expect(second.runtime.agents.require(imported.id).isBuiltin).toBe(false)
  })

  it('exports built-ins as templates and requires a name override on collision', async () => {
    const first = track(createTestRuntime())
    const second = track(createTestRuntime())
    const projectRoot = join(first.dir, 'market')
    first.runtime.projects.ensure(projectRoot, 'Market')
    second.runtime.projects.ensure(projectRoot, 'Market')
    const exportTools = toolsFor(first.runtime)
    const root1 = fakeExec('ses_root', projectRoot)
    await exportTools.get('factory_agent_export')!.execute({ agentId: 'agt_director' }, root1)
    const raw = readFileSync(join(projectRoot, '.agents', 'director.json'), 'utf8')
    expect(raw).not.toContain('agt_director')

    const director = second.runtime.agents.require('agt_director')
    const importTools = toolsFor(second.runtime, [...director.allowedTools, 'factory_agent_import'])
    const root2 = fakeExec('ses_root', projectRoot)
    await expectCode(importTools.get('factory_agent_import')!.execute({ fileId: 'director' }, root2), 'CONFLICT')
    const imported = (await importTools.get('factory_agent_import')!.execute(
      { fileId: 'director', name: 'DIRECTOR_TEMPLATE' },
      root2,
    )) as { name: string }
    expect(imported.name).toBe('DIRECTOR_TEMPLATE')
  })

  it('rejects allowedTools escalation on import', async () => {
    const first = track(createTestRuntime())
    const second = track(createTestRuntime())
    const projectRoot = join(first.dir, 'market')
    first.runtime.projects.ensure(projectRoot, 'Market')
    second.runtime.projects.ensure(projectRoot, 'Market')
    const source = first.runtime.agents.create({
      name: 'Escalating Agent',
      role: 'custom',
      allowedTools: ['factory_dispatch'],
    })
    const root1 = fakeExec('ses_root', projectRoot)
    await toolsFor(first.runtime).get('factory_agent_export')!.execute({ agentId: source.id }, root1)
    const importTools = toolsFor(second.runtime, ['read'])
    await expectCode(
      importTools.get('factory_agent_import')!.execute({ fileId: 'escalating-agent' }, fakeExec('ses_root', projectRoot)),
      'FORBIDDEN',
    )
    expect(second.runtime.agents.list({ limit: 200 }).some((agent) => agent.name === 'Escalating Agent')).toBe(false)
  })

  it('rejects higher accessLevel and missing skills', async () => {
    const first = track(createTestRuntime())
    const second = track(createTestRuntime())
    const projectRoot = join(first.dir, 'market')
    first.runtime.projects.ensure(projectRoot, 'Market')
    second.runtime.projects.ensure(projectRoot, 'Market')
    const root1 = fakeExec('ses_root', projectRoot)
    const root2 = fakeExec('ses_root', projectRoot)

    const elevated = first.runtime.agents.create({ name: 'Elevated Agent', role: 'custom', accessLevel: 'elevated' })
    await toolsFor(first.runtime).get('factory_agent_export')!.execute({ agentId: elevated.id }, root1)
    const level = vi.spyOn(second.runtime, 'agentAccessLevel').mockReturnValue('workspace')
    await expectCode(
      toolsFor(second.runtime, ['read']).get('factory_agent_import')!.execute({ fileId: 'elevated-agent' }, root2),
      'FORBIDDEN',
    )
    level.mockRestore()

    const noSkill = first.runtime.agents.create({ name: 'Missing Skill Agent', role: 'custom', skills: ['missing-skill'] })
    await toolsFor(first.runtime).get('factory_agent_export')!.execute({ agentId: noSkill.id }, root1)
    await expectCode(
      toolsFor(second.runtime, ['read']).get('factory_agent_import')!.execute({ fileId: 'missing-skill-agent' }, root2),
      'SKILL_NOT_FOUND',
    )
  })

  it('rejects secrets, traversal, invalid files and child callers', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const projectRoot = join(dir, 'market')
    runtime.projects.ensure(projectRoot, 'Market')
    const tools = toolsFor(runtime)
    const root = fakeExec('ses_root', projectRoot)
    const secretProfile = runtime.agents.create({
      name: 'Secret Agent',
      role: 'custom',
      systemInstruction: 'password = "supersecret123456"',
    })
    await expectCode(tools.get('factory_agent_export')!.execute({ agentId: secretProfile.id }, root), 'SECRET_DETECTED')
    expect(existsSync(join(projectRoot, '.agents', 'secret-agent.json'))).toBe(false)

    const traversal = (await tools.get('factory_agent_validate')!.execute({ fileId: '../escape' }, root)) as {
      valid: boolean
      code: string
    }
    expect(traversal.valid).toBe(false)
    expect(traversal.code).toBe('INVALID_INPUT')
    await expectCode(tools.get('factory_agent_import')!.execute({ fileId: '../escape' }, root), 'INVALID_INPUT')

    mkdirSync(join(projectRoot, '.agents'), { recursive: true })
    writeFileSync(join(projectRoot, '.agents', 'bad.json'), '{not-json')
    const bad = (await tools.get('factory_agent_validate')!.execute({ fileId: 'bad' }, root)) as {
      valid: boolean
      code: string
    }
    expect(bad.valid).toBe(false)
    expect(bad.code).toBe('INVALID_INPUT')

    runtime.allowToolsForChild('ses_child', ['factory_agent_export', 'factory_agent_import', 'factory_agent_validate'])
    await expectCode(
      tools.get('factory_agent_export')!.execute({ agentId: secretProfile.id }, fakeExec('ses_child', projectRoot)),
      'FORBIDDEN',
    )
  })

  it('has 63 factory tools / 71 actions and 66 plugin tools', () => {
    expect(new Set(TOOL_HEALTH_SPECS.map((spec) => spec.tool)).size).toBe(63)
    expect(TOOL_HEALTH_SPECS).toHaveLength(71)
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_agent_validate')?.mode).toBe('observed')
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_agent_import')?.risk).toBe('R1')
  })
})
