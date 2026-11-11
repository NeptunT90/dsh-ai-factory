import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { FactoryRuntime } from '../src/runtime.js'
import { registerAgentTools } from '../src/agents/tools.js'
import { registerSkillTools } from '../src/skills/tools.js'
import { TOOL_HEALTH_SPECS } from '../src/health/registry.js'
import { createTestRuntime, track } from './helpers.js'

function validSkill(id: string, name = 'Demo skill'): string {
  return [
    '---',
    'apiVersion: factory.skill/v1',
    `id: ${id}`,
    `name: ${name}`,
    'description: Management tool test skill',
    'version: 1',
    'roles: [custom]',
    'priority: 10',
    'enabled: true',
    '---',
    '# Instructions',
    '',
    'Apply the demo skill.',
    '',
  ].join('\n')
}

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_skill_tool',
    name: 'factory_skill_test',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: agentId,
      session: { header: { cwd } },
    },
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
  registerSkillTools(ctx, () => runtime, () => undefined)
  return tools
}

function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code })
}

describe('skill management tools', () => {
  it('creates, lists, gets and validates a skill', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'project'), 'Skill project')
    const tools = toolsFor(runtime)
    const exec = fakeExec('ses_root', project.rootPath)
    const content = validSkill('demo')

    const created = (await tools.get('factory_skill_create')!.execute({ id: 'demo', content }, exec)) as {
      id: string
      hash: string
      valid: boolean
    }
    expect(created.id).toBe('demo')
    expect(created.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(created.valid).toBe(true)
    expect(existsSync(join(project.rootPath, '.skills', 'demo.md'))).toBe(true)

    const listed = (await tools.get('factory_skill_list')!.execute({}, exec)) as {
      count: number
      skills: Array<{ id: string; hash: string; valid: boolean }>
    }
    expect(listed.count).toBe(1)
    expect(listed.skills[0]?.id).toBe('demo')
    expect(listed.skills[0]?.valid).toBe(true)

    const got = (await tools.get('factory_skill_get')!.execute({ id: 'demo' }, exec)) as {
      body: string
      hash: string
    }
    expect(got.body).toContain('Apply the demo skill')
    expect(got.hash).toBe(created.hash)

    const validated = (await tools.get('factory_skill_validate')!.execute({}, exec)) as {
      valid: boolean
      count: number
    }
    expect(validated).toEqual(expect.objectContaining({ valid: true, count: 1 }))
  })

  it('updates only with the expected hash and deletes the file', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'project'), 'Skill project')
    const tools = toolsFor(runtime)
    const exec = fakeExec('ses_root', project.rootPath)
    const created = (await tools.get('factory_skill_create')!.execute(
      { id: 'demo', content: validSkill('demo') },
      exec,
    )) as { hash: string }

    await expectCode(
      tools.get('factory_skill_update')!.execute(
        { id: 'demo', content: validSkill('demo', 'Changed'), expectedHash: 'bad' },
        exec,
      ),
      'CONFLICT',
    )
    const updated = (await tools.get('factory_skill_update')!.execute(
      { id: 'demo', content: validSkill('demo', 'Changed'), expectedHash: created.hash },
      exec,
    )) as { name: string; hash: string }
    expect(updated.name).toBe('Changed')
    expect(updated.hash).not.toBe(created.hash)

    await tools.get('factory_skill_delete')!.execute({ id: 'demo' }, exec)
    expect(existsSync(join(project.rootPath, '.skills', 'demo.md'))).toBe(false)
  })

  it('assigns a skill and accepts the same id through factory_agent_save', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'project'), 'Skill project')
    const tools = toolsFor(runtime)
    const exec = fakeExec('ses_root', project.rootPath)
    await tools.get('factory_skill_create')!.execute({ id: 'demo', content: validSkill('demo') }, exec)
    const profile = runtime.agents.create({ name: 'SKILL_TARGET', role: 'custom', allowedTools: ['read'] })

    const assigned = (await tools.get('factory_skill_assign')!.execute(
      { agentId: profile.id, skillId: 'demo', action: 'attach' },
      exec,
    )) as { skills: string[] }
    expect(assigned.skills).toEqual(['demo'])

    const saved = (await tools.get('factory_agent_save')!.execute(
      { id: profile.id, skills: ['demo'], title: 'With skill' },
      exec,
    )) as { skills: string[]; allowedTools: string[] }
    expect(saved.skills).toEqual(['demo'])
    expect(saved.allowedTools).toEqual(['read'])

    const audit = runtime.audit.recent(20).find((entry) => entry.event === 'agent.skills_changed')
    expect(audit?.data.newSkillIds).toEqual(['demo'])
  })

  it('rejects missing skills in factory_agent_save and factory_skill_assign', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'project'), 'Skill project')
    const tools = toolsFor(runtime)
    const exec = fakeExec('ses_root', project.rootPath)
    const profile = runtime.agents.create({ name: 'NO_SKILL', role: 'custom' })

    await expectCode(
      tools.get('factory_agent_save')!.execute({ name: 'MISSING_SKILL', skills: ['not-there'] }, exec),
      'SKILL_NOT_FOUND',
    )
    expect(runtime.agents.list({ limit: 200 }).some((agent) => agent.name === 'MISSING_SKILL')).toBe(false)
    await expectCode(
      tools.get('factory_skill_assign')!.execute({ agentId: profile.id, skillId: 'not-there' }, exec),
      'SKILL_NOT_FOUND',
    )
  })

  it('denies skill management and skill assignment to children', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'project'), 'Skill project')
    const tools = toolsFor(runtime)
    const root = fakeExec('ses_root', project.rootPath)
    await tools.get('factory_skill_create')!.execute({ id: 'demo', content: validSkill('demo') }, root)
    const profile = runtime.agents.create({ name: 'CHILD_TARGET', role: 'custom' })
    const child = fakeExec('ses_child', project.rootPath)
    runtime.allowToolsForChild('ses_child', ['factory_skill_create', 'factory_skill_assign'])

    await expectCode(
      tools.get('factory_skill_create')!.execute({ id: 'child', content: validSkill('child') }, child),
      'FORBIDDEN',
    )
    await expectCode(
      tools.get('factory_skill_assign')!.execute({ agentId: profile.id, skillId: 'demo' }, child),
      'FORBIDDEN',
    )
    expect(existsSync(join(project.rootPath, '.skills', 'child.md'))).toBe(false)
    expect(runtime.agents.require(profile.id).skills).toEqual([])
  })

  it('does not allow a child to obtain skill tools through factory_agent_save subset', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'project'), 'Skill project')
    const tools = toolsFor(runtime, ['read'])
    const exec = fakeExec('ses_root', project.rootPath)

    await expectCode(
      tools.get('factory_agent_save')!.execute(
        { name: 'SUBSET_BYPASS', allowedTools: ['factory_skill_create'] },
        exec,
      ),
      'FORBIDDEN',
    )
    expect(runtime.agents.list({ limit: 200 }).some((agent) => agent.name === 'SUBSET_BYPASS')).toBe(false)
  })

  it('protects built-in profiles from skill assignment', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'project'), 'Skill project')
    const tools = toolsFor(runtime)
    const exec = fakeExec('ses_root', project.rootPath)
    await tools.get('factory_skill_create')!.execute({ id: 'demo', content: validSkill('demo') }, exec)

    await expectCode(
      tools.get('factory_skill_assign')!.execute({ agentId: 'agt_director', skillId: 'demo' }, exec),
      'FORBIDDEN',
    )
    expect(runtime.agents.require('agt_director').skills).toEqual([])
  })

  it('has 58 factory tools / 66 actions in the health registry', () => {
    expect(new Set(TOOL_HEALTH_SPECS.map((spec) => spec.tool)).size).toBe(58)
    expect(TOOL_HEALTH_SPECS).toHaveLength(66)
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_skill_get')?.mode).toBe('observed')
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_skill_create')?.risk).toBe('R1')
    expect(TOOL_HEALTH_SPECS.some((spec) => spec.tool.startsWith('factory_skill_') && spec.risk === 'R2')).toBe(false)
  })
})
