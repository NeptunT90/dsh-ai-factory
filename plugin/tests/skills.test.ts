import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillStore } from '../src/skills/store.js'
import { SKILL_LIMITS } from '../src/skills/types.js'

function validSkill(id: string, overrides: Partial<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    apiVersion: 'factory.skill/v1',
    id,
    name: 'Code Review',
    description: 'Review code changes for regressions',
    version: '1',
    roles: '[developer, reviewer]',
    priority: '50',
    enabled: 'true',
    ...overrides,
  }
  const known = new Set(['apiVersion', 'id', 'name', 'description', 'version', 'roles', 'priority', 'enabled'])
  const extras = Object.entries(overrides)
    .filter(([key]) => !known.has(key))
    .map(([key, value]) => `${key}: ${value}`)
  return [
    '---',
    `apiVersion: ${values.apiVersion}`,
    `id: ${values.id}`,
    `name: ${values.name}`,
    `description: ${values.description}`,
    `version: ${values.version}`,
    `roles: ${values.roles}`,
    `priority: ${values.priority}`,
    `enabled: ${values.enabled}`,
    ...extras,
    '---',
    '# Instructions',
    '',
    'Inspect the diff and report regressions.',
    '',
  ].join('\n')
}

interface Fixture {
  root: string
  skillsDir: string
  store: SkillStore
  cleanup(): void
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ai-factory-skills-'))
  const skillsDir = join(root, '.skills')
  return {
    root,
    skillsDir,
    store: new SkillStore(root),
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`expected ${code}`)
}

describe('SkillStore', () => {
  it('creates, lists, reads and atomically updates a valid skill', () => {
    const f = fixture()
    try {
      const created = f.store.create('code-review', validSkill('code-review'))
      expect(created.id).toBe('code-review')
      expect(created.roles).toEqual(['developer', 'reviewer'])
      expect(created.body).toContain('Inspect the diff')
      expect(created.hash).toMatch(/^[a-f0-9]{64}$/)
      expect(f.store.list()).toHaveLength(1)
      expect(f.store.get('code-review').name).toBe('Code Review')

      const changed = validSkill('code-review', { name: 'Code Review v2' })
      const updated = f.store.update('code-review', changed, created.hash)
      expect(updated.name).toBe('Code Review v2')
      expect(updated.hash).not.toBe(created.hash)
      expect(readdirSync(f.skillsDir).filter((name) => name.endsWith('.tmp'))).toHaveLength(0)

      expectCode(() => f.store.update('code-review', changed, created.hash), 'CONFLICT')
      f.store.delete('code-review')
      expectCode(() => f.store.get('code-review'), 'SKILL_NOT_FOUND')
    } finally {
      f.cleanup()
    }
  })

  it('rejects missing frontmatter and invalid apiVersion', () => {
    const f = fixture()
    try {
      expectCode(() => f.store.create('plain', '# no frontmatter\n'), 'SKILL_INVALID')
      expectCode(
        () => f.store.create('bad-api', validSkill('bad-api', { apiVersion: 'factory.skill/v2' })),
        'SKILL_INVALID',
      )
    } finally {
      f.cleanup()
    }
  })

  it('requires the frontmatter id to match the filename', () => {
    const f = fixture()
    try {
      expectCode(() => f.store.create('alpha', validSkill('beta')), 'SKILL_INVALID')
    } finally {
      f.cleanup()
    }
  })

  it('rejects unknown roles and malformed priority', () => {
    const f = fixture()
    try {
      expectCode(() => f.store.create('roles', validSkill('roles', { roles: '[wizard]' })), 'SKILL_INVALID')
      expectCode(() => f.store.create('priority', validSkill('priority', { priority: '101' })), 'SKILL_INVALID')
    } finally {
      f.cleanup()
    }
  })

  it('rejects forbidden and unknown frontmatter fields', () => {
    const f = fixture()
    try {
      const allowed = validSkill('allowed', { allowedTools: '[read]' })
      expectCode(() => f.store.create('allowed', allowed), 'SKILL_INVALID')
      const complete = validSkill('complete', { complete: 'true' })
      expectCode(() => f.store.create('complete', complete), 'SKILL_INVALID')
      const unknown = validSkill('unknown', { surprise: 'yes' })
      expectCode(() => f.store.create('unknown', unknown), 'SKILL_INVALID')
    } finally {
      f.cleanup()
    }
  })

  it('enforces the 16 KiB body limit and the 64 KiB total limit', () => {
    const f = fixture()
    try {
      const huge = validSkill('huge').replace('Inspect the diff and report regressions.', 'x'.repeat(SKILL_LIMITS.maxBodyBytes + 1))
      expectCode(() => f.store.create('huge', huge), 'SKILL_TOO_LARGE')

      mkdirSync(f.skillsDir, { recursive: true })
      for (let index = 0; index < 5; index += 1) {
        const id = `big-${index}`
        writeFileSync(join(f.skillsDir, `${id}.md`), validSkill(id, { name: id }).replace('Inspect the diff and report regressions.', 'x'.repeat(13 * 1024)))
      }
      expectCode(() => f.store.list(), 'SKILL_LIMIT_EXCEEDED')
    } finally {
      f.cleanup()
    }
  })

  it('rejects path traversal, absolute ids and invalid ids', () => {
    const f = fixture()
    try {
      for (const id of ['../escape', '..\\escape', 'C:\\absolute', '/absolute', 'Bad_ID', 'a/b']) {
        expectCode(() => f.store.get(id), 'SKILL_INVALID')
      }
    } finally {
      f.cleanup()
    }
  })

  it('rejects symlinked skill files', () => {
    const f = fixture()
    try {
      f.store.create('target', validSkill('target'))
      try {
        symlinkSync(join(f.skillsDir, 'target.md'), join(f.skillsDir, 'linked.md'))
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
        if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') return
        throw error
      }
      expectCode(() => f.store.list(), 'SKILL_INVALID')
    } finally {
      f.cleanup()
    }
  })

  it('rejects NUL, invalid UTF-8 and secret material', () => {
    const f = fixture()
    try {
      mkdirSync(f.skillsDir, { recursive: true })
      writeFileSync(join(f.skillsDir, 'nul.md'), Buffer.from(`${validSkill('nul')}\u0000`, 'utf8'))
      expectCode(() => f.store.list(), 'SKILL_INVALID')

      rmSync(join(f.skillsDir, 'nul.md'))
      writeFileSync(join(f.skillsDir, 'utf8.md'), Buffer.from([0xff, 0xfe, 0x00]))
      expectCode(() => f.store.list(), 'SKILL_INVALID')

      rmSync(join(f.skillsDir, 'utf8.md'))
      const secret = validSkill('secret').replace('Inspect the diff and report regressions.', 'password = "supersecret123456"')
      expectCode(() => f.store.create('secret', secret), 'SKILL_SECRET_DETECTED')
    } finally {
      f.cleanup()
    }
  })

  it('enforces the 50-file limit', () => {
    const f = fixture()
    try {
      mkdirSync(f.skillsDir, { recursive: true })
      for (let index = 0; index < SKILL_LIMITS.maxFiles + 1; index += 1) {
        const id = `skill-${String(index).padStart(2, '0')}`
        writeFileSync(join(f.skillsDir, `${id}.md`), validSkill(id))
      }
      expectCode(() => f.store.list(), 'SKILL_LIMIT_EXCEEDED')
    } finally {
      f.cleanup()
    }
  })
})
