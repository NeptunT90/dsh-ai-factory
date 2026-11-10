import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SkillStore } from '../src/skills/store.js'
import { createTestRuntime, track } from './helpers.js'

function validSkill(id: string, enabled = true): string {
  return [
    '---',
    'apiVersion: factory.skill/v1',
    `id: ${id}`,
    `name: ${id}`,
    'description: Resolved test skill',
    'version: 3',
    'roles: [custom]',
    'priority: 7',
    `enabled: ${enabled ? 'true' : 'false'}`,
    '---',
    `# ${id}`,
    '',
    'Apply this project skill.',
    '',
  ].join('\n')
}

function expectNotFound(fn: () => unknown): void {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ code: 'SKILL_NOT_FOUND' })
    return
  }
  throw new Error('expected SKILL_NOT_FOUND')
}

describe('SkillService.resolve', () => {
  it('resolves assigned skills with their SHA256', () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'skill-project'), 'Skill project')
    const store = new SkillStore(project.rootPath)
    const created = store.create('alpha', validSkill('alpha'))
    const agent = runtime.agents.create({ name: 'SKILLED', role: 'custom', skills: ['alpha'] })

    const resolved = runtime.skills.resolve(agent.id, project.id)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.id).toBe('alpha')
    expect(resolved[0]?.version).toBe(3)
    expect(resolved[0]?.hash).toBe(created.hash)
  })

  it('fails closed for a missing skill', () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'skill-project'), 'Skill project')
    const agent = runtime.agents.create({ name: 'MISSING_SKILL', role: 'custom', skills: ['missing'] })
    expectNotFound(() => runtime.skills.resolve(agent.id, project.id))
  })

  it('fails closed for an invalid skill file', () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'skill-project'), 'Skill project')
    mkdirSync(join(project.rootPath, '.skills'), { recursive: true })
    writeFileSync(join(project.rootPath, '.skills', 'broken.md'), 'not a skill\n')
    const agent = runtime.agents.create({ name: 'INVALID_SKILL', role: 'custom', skills: ['broken'] })
    expectNotFound(() => runtime.skills.resolve(agent.id, project.id))
  })

  it('fails closed for a disabled skill', () => {
    const { runtime, dir } = track(createTestRuntime())
    const project = runtime.projects.ensure(join(dir, 'skill-project'), 'Skill project')
    const store = new SkillStore(project.rootPath)
    store.create('disabled', validSkill('disabled', false))
    const agent = runtime.agents.create({ name: 'DISABLED_SKILL', role: 'custom', skills: ['disabled'] })
    expectNotFound(() => runtime.skills.resolve(agent.id, project.id))
  })
})
