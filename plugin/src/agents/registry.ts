import type { FactoryDatabase } from '../storage/database.js'
import { FactoryError } from '../core/errors.js'
import { newId, now } from '../core/ids.js'
import { BUILTIN_AGENTS } from './builtins.js'
import {
  ACCESS_LEVELS,
  AGENT_ROLES,
  DEFAULT_AGENT_LIMITS,
  MEMORY_SCOPES,
  type AccessLevel,
  type AgentCreateInput,
  type AgentLimits,
  type AgentMemoryScope,
  type AgentProfile,
  type AgentRole,
  type AgentUpdateInput,
} from './types.js'

interface AgentRow {
  id: string
  name: string
  role: AgentRole
  title: string
  description: string
  system_instruction: string
  model_provider: string | null
  model: string | null
  reasoning_effort: string | null
  tools: string
  allowed_tools: string
  skills: string
  access_level: AccessLevel
  memory_scope: AgentMemoryScope
  limits: string
  enabled: number
  is_builtin: number
  version: number
  created_at: number
  updated_at: number
}

const ROLE_SET = new Set<string>(AGENT_ROLES)
const ACCESS_SET = new Set<string>(ACCESS_LEVELS)
const MEMORY_SET = new Set<string>(MEMORY_SCOPES)

function parseTools(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function normalizeTools(tools: readonly string[] | undefined): string[] {
  if (!tools) return []
  const result: string[] = []
  for (const raw of tools) {
    const tool = raw.trim().slice(0, 120)
    if (tool === '') continue
    if (!result.includes(tool)) result.push(tool)
    if (result.length >= 100) break
  }
  return result
}

function normalizeLimits(input: Partial<AgentLimits> | undefined): AgentLimits {
  const merged = { ...DEFAULT_AGENT_LIMITS, ...(input ?? {}) }
  return {
    maxConcurrentTasks: Math.max(1, Math.min(16, Math.floor(Number(merged.maxConcurrentTasks) || 1))),
    maxAttempts: Math.max(1, Math.min(10, Math.floor(Number(merged.maxAttempts) || 1))),
    timeoutMs: Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.floor(Number(merged.timeoutMs) || 1000))),
    autonomy: merged.autonomy === 'trusted' || merged.autonomy === 'safe' ? merged.autonomy : 'autonomous',
  }
}

function mapAgent(row: AgentRow): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    title: row.title,
    description: row.description,
    systemInstruction: row.system_instruction,
    modelProvider: row.model_provider,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    tools: parseTools(row.tools),
    allowedTools: parseTools(row.allowed_tools),
    skills: parseTools(row.skills),
    accessLevel: row.access_level,
    memoryScope: row.memory_scope,
    limits: normalizeLimits(JSON.parse(row.limits) as Partial<AgentLimits>),
    enabled: row.enabled === 1,
    isBuiltin: row.is_builtin === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT = `
  SELECT id, name, role, title, description, system_instruction, model_provider, model,
         reasoning_effort, tools, allowed_tools, skills, access_level, memory_scope, limits, enabled, is_builtin,
         version, created_at, updated_at
  FROM agent_profiles`

/** Durable registry of specialist profiles. */
export class AgentRegistry {
  constructor(private readonly db: FactoryDatabase) {}

  /** Idempotently install the built-in profiles without overwriting user edits. */
  seedBuiltins(): void {
    const ts = now()
    for (const agent of BUILTIN_AGENTS) {
      this.db.run(
        `INSERT OR IGNORE INTO agent_profiles
          (id, name, role, title, description, system_instruction, model_provider, model,
           reasoning_effort, tools, allowed_tools, access_level, memory_scope, limits, enabled, is_builtin,
           version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        [
          agent.id,
          agent.name,
          agent.role ?? 'custom',
          agent.title ?? agent.name,
          agent.description ?? '',
          agent.systemInstruction ?? '',
          JSON.stringify(normalizeTools(agent.tools)),
          JSON.stringify(normalizeTools(agent.allowedTools)),
          agent.accessLevel ?? 'workspace',
          agent.memoryScope ?? 'project',
          JSON.stringify(normalizeLimits(agent.limits)),
          agent.enabled === false ? 0 : 1,
          ts,
          ts,
        ],
      )
      this.db.run(
        "UPDATE agent_profiles SET allowed_tools = ? WHERE id = ? AND is_builtin = 1 AND (allowed_tools IS NULL OR allowed_tools = '[]')",
        [JSON.stringify(normalizeTools(agent.allowedTools)), agent.id],
      )
    }
  }

  list(options: { role?: AgentRole; enabledOnly?: boolean; limit?: number } = {}): AgentProfile[] {
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 100)))
    const where: string[] = []
    const params: Array<string | number> = []
    if (options.role) {
      where.push('role = ?')
      params.push(options.role)
    }
    if (options.enabledOnly) where.push('enabled = 1')
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY is_builtin DESC, name ASC LIMIT ?`
    return this.db.all<AgentRow>(sql, [...params, limit]).map(mapAgent)
  }

  get(id: string): AgentProfile | undefined {
    const row = this.db.get<AgentRow>(`${SELECT} WHERE id = ?`, [id])
    return row ? mapAgent(row) : undefined
  }

  require(id: string): AgentProfile {
    const agent = this.get(id)
    if (!agent) throw new FactoryError('NOT_FOUND', `Профиль агента не найден: ${id}`, { agentId: id })
    return agent
  }

  findByRole(role: AgentRole): AgentProfile | undefined {
    return this.list({ role, enabledOnly: true, limit: 1 })[0]
  }

  create(input: AgentCreateInput): AgentProfile {
    const name = input.name.trim()
    if (name === '' || name.length > 80) throw new FactoryError('INVALID_INPUT', 'Имя агента должно быть от 1 до 80 символов')
    const role = input.role ?? 'custom'
    if (!ROLE_SET.has(role)) throw new FactoryError('INVALID_INPUT', `Неизвестная роль: ${String(role)}`)
    const accessLevel = input.accessLevel ?? 'workspace'
    if (!ACCESS_SET.has(accessLevel)) throw new FactoryError('INVALID_INPUT', `Неизвестный уровень доступа: ${String(accessLevel)}`)
    const memoryScope = input.memoryScope ?? 'project'
    if (!MEMORY_SET.has(memoryScope)) throw new FactoryError('INVALID_INPUT', `Неизвестная область памяти: ${String(memoryScope)}`)
    const existing = this.db.get<{ id: string }>('SELECT id FROM agent_profiles WHERE name = ?', [name])
    if (existing) throw new FactoryError('CONFLICT', `Агент с именем "${name}" уже существует: ${existing.id}`)

    const id = newId('agt')
    const ts = now()
    this.db.run(
      `INSERT INTO agent_profiles
        (id, name, role, title, description, system_instruction, model_provider, model,
         reasoning_effort, tools, allowed_tools, skills, access_level, memory_scope, limits, enabled, is_builtin,
         version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      [
        id,
        name,
        role,
        (input.title ?? name).trim().slice(0, 200) || name,
        (input.description ?? '').slice(0, 4000),
        (input.systemInstruction ?? '').slice(0, 20_000),
        input.modelProvider?.trim() || null,
        input.model?.trim() || null,
        input.reasoningEffort?.trim() || null,
        JSON.stringify(normalizeTools(input.tools)),
        JSON.stringify(normalizeTools(input.allowedTools)),
        JSON.stringify(normalizeTools(input.skills)),
        accessLevel,
        memoryScope,
        JSON.stringify(normalizeLimits(input.limits)),
        input.enabled === false ? 0 : 1,
        ts,
        ts,
      ],
    )
    return this.require(id)
  }

  update(id: string, input: AgentUpdateInput): AgentProfile {
    const current = this.require(id)
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new FactoryError('VERSION_MISMATCH', `Ожидалась версия ${input.expectedVersion}, актуальная ${current.version}`, {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      })
    }
    const name = input.name === undefined ? current.name : input.name.trim()
    if (name === '' || name.length > 80) throw new FactoryError('INVALID_INPUT', 'Имя агента должно быть от 1 до 80 символов')
    if (name !== current.name) {
      const collision = this.db.get<{ id: string }>('SELECT id FROM agent_profiles WHERE name = ? AND id <> ?', [name, id])
      if (collision) throw new FactoryError('CONFLICT', `Агент с именем "${name}" уже существует: ${collision.id}`)
    }
    const role = input.role ?? current.role
    if (!ROLE_SET.has(role)) throw new FactoryError('INVALID_INPUT', `Неизвестная роль: ${String(role)}`)
    const accessLevel = input.accessLevel ?? current.accessLevel
    if (!ACCESS_SET.has(accessLevel)) throw new FactoryError('INVALID_INPUT', `Неизвестный уровень доступа: ${String(accessLevel)}`)
    const memoryScope = input.memoryScope ?? current.memoryScope
    if (!MEMORY_SET.has(memoryScope)) throw new FactoryError('INVALID_INPUT', `Неизвестная область памяти: ${String(memoryScope)}`)
    const limits = normalizeLimits(input.limits === undefined ? current.limits : { ...current.limits, ...input.limits })
    const ts = now()
    this.db.run(
      `UPDATE agent_profiles
       SET name = ?, role = ?, title = ?, description = ?, system_instruction = ?,
           model_provider = ?, model = ?, reasoning_effort = ?, tools = ?, allowed_tools = ?, skills = ?, access_level = ?,
           memory_scope = ?, limits = ?, enabled = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [
        name,
        role,
        (input.title === undefined ? current.title : input.title.trim().slice(0, 200)) || name,
        (input.description === undefined ? current.description : input.description.slice(0, 4000)),
        (input.systemInstruction === undefined ? current.systemInstruction : input.systemInstruction.slice(0, 20_000)),
        input.modelProvider === undefined ? current.modelProvider : input.modelProvider?.trim() || null,
        input.model === undefined ? current.model : input.model?.trim() || null,
        input.reasoningEffort === undefined ? current.reasoningEffort : input.reasoningEffort?.trim() || null,
        JSON.stringify(input.tools === undefined ? current.tools : normalizeTools(input.tools)),
        JSON.stringify(input.allowedTools === undefined ? current.allowedTools : normalizeTools(input.allowedTools)),
        JSON.stringify(input.skills === undefined ? current.skills : normalizeTools(input.skills)),
        accessLevel,
        memoryScope,
        JSON.stringify(limits),
        (input.enabled === undefined ? current.enabled : input.enabled) ? 1 : 0,
        ts,
        id,
      ],
    )
    return this.require(id)
  }

  setEnabled(id: string, enabled: boolean): AgentProfile {
    return this.update(id, { enabled })
  }

  count(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM agent_profiles')?.n ?? 0
  }
}
