import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import { assertAgentTargetMutable } from '../agents/tools.js'
import { SkillStore } from './store.js'
import type { SkillRecord } from './types.js'
import { validateSkillId } from './validator.js'

const SKILL_META = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    version: { type: 'number', required: true },
    roles: { type: 'array', items: { type: 'string' }, required: true },
    priority: { type: 'number', required: true },
    enabled: { type: 'boolean', required: true },
    hash: { type: 'string', required: true },
    relativePath: { type: 'string', required: true },
    valid: { type: 'boolean', required: true },
  },
} as const

interface SkillMetaView {
  id: string
  name: string
  description: string
  version: number
  roles: string[]
  priority: number
  enabled: boolean
  hash: string
  relativePath: string
  valid: boolean
}

function meta(skill: SkillRecord): SkillMetaView {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    roles: [...skill.roles],
    priority: skill.priority,
    enabled: skill.enabled,
    hash: skill.hash,
    relativePath: skill.relativePath,
    valid: true,
  }
}

function formatMeta(skill: SkillRecord): string {
  return [
    `${skill.id}: ${skill.name} v${skill.version}`,
    `roles: ${skill.roles.join(', ')} · priority: ${skill.priority} · enabled: ${skill.enabled ? 'yes' : 'no'}`,
    `hash: ${skill.hash}`,
    skill.description,
  ].join('\n')
}

function runtimeOf(getRuntime: () => FactoryRuntime | undefined, getStartupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError('UNAVAILABLE', `AI Factory не инициализирован: ${getStartupError() ?? 'причина неизвестна'}`)
  }
  return runtime
}

/** All skill management tools are operator/root-only. */
function assertSkillRoot(runtime: FactoryRuntime, exec: Pick<ToolRunContext, 'agent'>): void {
  if (exec.agent && runtime.hasChildAllowlist(exec.agent.id)) {
    throw new FactoryError('FORBIDDEN', 'Управление skills доступно только root/DIRECTOR')
  }
}

function projectStore(runtime: FactoryRuntime, exec: Pick<ToolRunContext, 'agent'>): SkillStore {
  return new SkillStore(runtime.projectFor(exec).rootPath)
}

function skillOrNotFound(error: unknown, id: string): never {
  if (error instanceof FactoryError) {
    throw new FactoryError('SKILL_NOT_FOUND', `Навык ${id} недоступен в текущем проекте`, {
      skillId: id,
      reason: error.code,
    })
  }
  throw error
}

export function registerSkillTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_skill_list',
        description: 'Список project-local .skills/*.md: id, name, version, roles, hash, valid. Root-only.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              skills: { type: 'array', items: SKILL_META, required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.count === 0
                ? 'Навыков нет.'
                : value.skills.map((skill) => `- ${skill.id} · ${skill.name} · v${skill.version} · ${skill.hash.slice(0, 12)}`).join('\n'),
            },
          ],
        },
        async execute(_args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertSkillRoot(runtime, exec)
          const skills = projectStore(runtime, exec).list()
          return { count: skills.length, skills: skills.map(meta) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_skill_get',
        description: 'Метаданные и body одного skill текущего проекта. Root-only.',
        parameters: {
          id: { type: 'string', required: true, description: 'skill id' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ...SKILL_META.properties,
              body: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [
            { type: 'text', text: `${formatMeta(value as unknown as SkillRecord)}\n\n${value.body}` },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertSkillRoot(runtime, exec)
          const skill = projectStore(runtime, exec).get(args.id)
          return { ...meta(skill), body: skill.body }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_skill_validate',
        description: 'Проверить один skill или все .skills/*.md без записи. Root-only.',
        parameters: {
          id: { type: 'string', description: 'skill id; пусто — проверить все' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              valid: { type: 'boolean', required: true },
              count: { type: 'number', required: true },
              id: { type: 'string', required: true },
              hash: { type: 'string', required: true },
              code: { type: 'string', required: true },
              message: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [
            { type: 'text', text: value.valid ? `valid · ${value.count} skill(s)` : `invalid: ${value.code} · ${value.message}` },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertSkillRoot(runtime, exec)
          const store = projectStore(runtime, exec)
          try {
            if (args.id?.trim()) {
              const skill = store.get(args.id.trim())
              return { valid: true, count: 1, id: skill.id, hash: skill.hash, code: '', message: 'valid' }
            }
            const skills = store.list()
            return {
              valid: true,
              count: skills.length,
              id: '',
              hash: '',
              code: '',
              message: skills.length === 0 ? 'skills directory is empty' : 'all skills are valid',
            }
          } catch (error) {
            const code = error instanceof FactoryError ? error.code : 'SKILL_INVALID'
            const message = error instanceof Error ? error.message : String(error)
            return { valid: false, count: 0, id: args.id?.trim() ?? '', hash: '', code, message }
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_skill_create',
        description: 'Атомарно создать .skills/<id>.md из полного Markdown с frontmatter. Root-only.',
        parameters: {
          id: { type: 'string', required: true, description: 'skill id' },
          content: { type: 'string', required: true, description: 'Полный Markdown-файл с YAML frontmatter' },
        },
        output: { schema: SKILL_META, render: (_args, value) => [{ type: 'text', text: formatMeta(value as unknown as SkillRecord) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertSkillRoot(runtime, exec)
          const store = projectStore(runtime, exec)
          const skill = store.create(args.id, args.content)
          runtime.auditTool('skill.created', runtime.projectFor(exec), exec, { skillId: skill.id, hash: skill.hash })
          return meta(skill)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_skill_update',
        description: 'Обновить skill с optimistic expectedHash. Root-only.',
        parameters: {
          id: { type: 'string', required: true, description: 'skill id' },
          content: { type: 'string', required: true, description: 'Новый полный Markdown-файл' },
          expectedHash: { type: 'string', required: true, description: 'SHA-256 текущего файла' },
        },
        output: { schema: SKILL_META, render: (_args, value) => [{ type: 'text', text: formatMeta(value as unknown as SkillRecord) }] },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertSkillRoot(runtime, exec)
          const store = projectStore(runtime, exec)
          const skill = store.update(args.id, args.content, args.expectedHash)
          runtime.auditTool('skill.updated', runtime.projectFor(exec), exec, { skillId: skill.id, hash: skill.hash })
          return meta(skill)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_skill_delete',
        description: 'Удалить .skills/<id>.md. Root-only.',
        parameters: {
          id: { type: 'string', required: true, description: 'skill id' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              deleted: { type: 'boolean', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: `Удалён навык ${value.id}.` }],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertSkillRoot(runtime, exec)
          projectStore(runtime, exec).delete(args.id)
          runtime.auditTool('skill.deleted', runtime.projectFor(exec), exec, { skillId: args.id })
          return { id: args.id, deleted: true }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_skill_assign',
        description: 'Привязать/отвязать project-local skill к профилю. Root-only.',
        parameters: {
          agentId: { type: 'string', required: true, description: 'id профиля' },
          skillId: { type: 'string', required: true, description: 'skill id' },
          action: { type: 'string', enum: ['attach', 'detach'], description: 'attach (default) или detach' },
          expectedVersion: { type: 'number', description: 'Опциональная проверка версии профиля' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              agentId: { type: 'string', required: true },
              action: { type: 'string', required: true },
              skills: { type: 'array', items: { type: 'string' }, required: true },
              skillId: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [
            { type: 'text', text: `${value.action}: ${value.skillId ?? ''} → ${value.agentId}\nskills: ${value.skills.join(', ') || '—'}` },
          ],
        },
        async execute(args, exec) {
          const runtime = runtimeOf(getRuntime, getStartupError)
          assertSkillRoot(runtime, exec)
          const action = args.action ?? 'attach'
          assertAgentTargetMutable(runtime, exec, { id: args.agentId })
          const profile = runtime.agents.require(args.agentId)
          validateSkillId(args.skillId)
          const store = projectStore(runtime, exec)
          if (action === 'attach') {
            try {
              const skill = store.get(args.skillId)
              if (!skill.enabled) {
                throw new FactoryError('SKILL_NOT_FOUND', `Навык ${args.skillId} отключён`, { skillId: args.skillId, reason: 'disabled' })
              }
            } catch (error) {
              if (error instanceof FactoryError && error.code !== 'SKILL_NOT_FOUND') skillOrNotFound(error, args.skillId)
              throw error
            }
          }
          const oldSkills = [...profile.skills]
          const next = action === 'attach'
            ? [...new Set([...oldSkills, args.skillId])]
            : oldSkills.filter((id) => id !== args.skillId)
          if (args.expectedVersion !== undefined && profile.version !== args.expectedVersion) {
            throw new FactoryError('VERSION_MISMATCH', 'Версия профиля не совпадает', {
              expectedVersion: args.expectedVersion,
              actualVersion: profile.version,
            })
          }
          const updated = runtime.agents.update(profile.id, { skills: next })
          runtime.auditTool('agent.skills_changed', null, exec, {
            agentId: profile.id,
            oldSkillIds: oldSkills,
            newSkillIds: [...updated.skills],
            action,
            skillId: args.skillId,
          })
          return { agentId: updated.id, action, skills: [...updated.skills], skillId: args.skillId }
        },
      }),
    ),
  )

  return disposers
}
