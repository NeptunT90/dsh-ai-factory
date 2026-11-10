import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import { detectSecrets } from '../core/security.js'
import { SkillStore } from '../skills/store.js'
import type { FactoryRuntime } from '../runtime.js'
import {
  ACCESS_LEVELS,
  AGENT_ROLES,
  MEMORY_SCOPES,
  type AccessLevel,
  type AgentProfile,
  type AgentLimits,
  type AgentMemoryScope,
  type AgentRole,
} from './types.js'

export const AGENT_MARKETPLACE_FORMAT = 'factory.agent/v1'
const FILE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const MAX_FILE_BYTES = 128 * 1024
const PROFILE_KEYS = new Set([
  'name',
  'role',
  'title',
  'description',
  'systemInstruction',
  'modelProvider',
  'model',
  'reasoningEffort',
  'tools',
  'allowedTools',
  'skills',
  'accessLevel',
  'memoryScope',
  'limits',
  'enabled',
])
const FILE_KEYS = new Set(['format', 'id', 'exportedAt', 'profile'])

interface PortableProfile {
  name: string
  role: AgentRole
  title: string
  description: string
  systemInstruction: string
  modelProvider: string | null
  model: string | null
  reasoningEffort: string | null
  tools: string[]
  allowedTools: string[]
  skills: string[]
  accessLevel: AccessLevel
  memoryScope: AgentMemoryScope
  limits: AgentLimits
  enabled: boolean
}

interface PortableFile {
  format: typeof AGENT_MARKETPLACE_FORMAT
  id: string
  exportedAt: number
  profile: PortableProfile
}

export interface AgentMarketplaceValidation {
  readonly valid: boolean
  readonly marketplaceId: string
  readonly name: string
  readonly code: string
  readonly message: string
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly requestedAllowedTools: readonly string[]
  readonly missingAllowedTools: readonly string[]
  readonly missingSkills: readonly string[]
  readonly accessLevel: string
  readonly profile: PortableProfile | null
}

export interface AgentMarketplaceExport {
  readonly marketplaceId: string
  readonly relativePath: string
  readonly hash: string
  readonly profile: PortableProfile
}

export interface AgentMarketplaceImport {
  readonly agent: AgentProfile
  readonly marketplaceId: string
}

function slugify(name: string): string {
  const value = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return value === '' ? 'agent' : value
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function accessRank(level: string): number {
  const index = (ACCESS_LEVELS as readonly string[]).indexOf(level)
  return index < 0 ? -1 : index
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new FactoryError('INVALID_INPUT', `${field} должен быть массивом строк`)
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new FactoryError('INVALID_INPUT', `${field} содержит не строку`)
    const text = item.trim()
    if (text === '') continue
    if (text.length > 120) throw new FactoryError('INVALID_INPUT', `${field} содержит слишком длинное значение`)
    if (!result.includes(text)) result.push(text)
    if (result.length >= 100) break
  }
  return result
}

function validateLimits(value: unknown): AgentLimits {
  if (!isRecord(value)) throw new FactoryError('INVALID_INPUT', 'limits должен быть объектом')
  const maxConcurrentTasks = Number(value.maxConcurrentTasks)
  const maxAttempts = Number(value.maxAttempts)
  const timeoutMs = Number(value.timeoutMs)
  if (!Number.isSafeInteger(maxConcurrentTasks) || maxConcurrentTasks < 1 || maxConcurrentTasks > 16) {
    throw new FactoryError('INVALID_INPUT', 'limits.maxConcurrentTasks должен быть 1..16')
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new FactoryError('INVALID_INPUT', 'limits.maxAttempts должен быть 1..10')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 24 * 60 * 60 * 1000) {
    throw new FactoryError('INVALID_INPUT', 'limits.timeoutMs вне допустимого диапазона')
  }
  if (value.autonomy !== 'safe' && value.autonomy !== 'autonomous' && value.autonomy !== 'trusted') {
    throw new FactoryError('INVALID_INPUT', 'limits.autonomy должен быть safe/autonomous/trusted')
  }
  return { maxConcurrentTasks, maxAttempts, timeoutMs, autonomy: value.autonomy }
}

function portableProfile(profile: AgentProfile): PortableProfile {
  return {
    name: profile.name,
    role: profile.role,
    title: profile.title,
    description: profile.description,
    systemInstruction: profile.systemInstruction,
    modelProvider: profile.modelProvider,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort,
    tools: [...profile.tools],
    allowedTools: [...profile.allowedTools],
    skills: [...profile.skills],
    accessLevel: profile.accessLevel,
    memoryScope: profile.memoryScope,
    limits: { ...profile.limits },
    enabled: profile.enabled,
  }
}

function parseProfile(raw: unknown): PortableProfile {
  if (!isRecord(raw)) throw new FactoryError('INVALID_INPUT', 'profile должен быть объектом')
  for (const key of Object.keys(raw)) {
    if (!PROFILE_KEYS.has(key)) throw new FactoryError('INVALID_INPUT', `Неизвестное поле profile: ${key}`)
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (name === '' || name.length > 80) throw new FactoryError('INVALID_INPUT', 'profile.name должен быть 1..80 символов')
  if (typeof raw.role !== 'string' || !(AGENT_ROLES as readonly string[]).includes(raw.role)) {
    throw new FactoryError('INVALID_INPUT', 'profile.role неизвестна')
  }
  if (typeof raw.accessLevel !== 'string' || !(ACCESS_LEVELS as readonly string[]).includes(raw.accessLevel)) {
    throw new FactoryError('INVALID_INPUT', 'profile.accessLevel неизвестен')
  }
  if (typeof raw.memoryScope !== 'string' || !(MEMORY_SCOPES as readonly string[]).includes(raw.memoryScope)) {
    throw new FactoryError('INVALID_INPUT', 'profile.memoryScope неизвестен')
  }
  if (typeof raw.systemInstruction !== 'string' || raw.systemInstruction.length > 20_000) {
    throw new FactoryError('INVALID_INPUT', 'profile.systemInstruction должен быть строкой до 20 000 символов')
  }
  if (typeof raw.enabled !== 'boolean') throw new FactoryError('INVALID_INPUT', 'profile.enabled должен быть boolean')
  for (const field of ['title', 'description'] as const) {
    if (typeof raw[field] !== 'string') throw new FactoryError('INVALID_INPUT', `profile.${field} должен быть строкой`)
  }
  for (const field of ['modelProvider', 'model', 'reasoningEffort'] as const) {
    if (raw[field] !== null && typeof raw[field] !== 'string') {
      throw new FactoryError('INVALID_INPUT', `profile.${field} должен быть строкой или null`)
    }
  }
  return {
    name,
    role: raw.role as AgentRole,
    title: raw.title as string,
    description: raw.description as string,
    systemInstruction: raw.systemInstruction,
    modelProvider: raw.modelProvider as string | null,
    model: raw.model as string | null,
    reasoningEffort: raw.reasoningEffort as string | null,
    tools: stringArray(raw.tools, 'profile.tools'),
    allowedTools: stringArray(raw.allowedTools, 'profile.allowedTools'),
    skills: stringArray(raw.skills, 'profile.skills'),
    accessLevel: raw.accessLevel as AccessLevel,
    memoryScope: raw.memoryScope as AgentMemoryScope,
    limits: validateLimits(raw.limits),
    enabled: raw.enabled,
  }
}

function parsePortableFile(raw: unknown, expectedId: string): PortableFile {
  if (!isRecord(raw)) throw new FactoryError('INVALID_INPUT', 'Agent file должен быть JSON-объектом')
  for (const key of Object.keys(raw)) {
    if (!FILE_KEYS.has(key)) throw new FactoryError('INVALID_INPUT', `Неизвестное поле файла: ${key}`)
  }
  if (raw.format !== AGENT_MARKETPLACE_FORMAT) {
    throw new FactoryError('INVALID_INPUT', `format должен быть ${AGENT_MARKETPLACE_FORMAT}`)
  }
  if (raw.id !== expectedId) throw new FactoryError('INVALID_INPUT', 'id файла должен совпадать с именем файла')
  if (!Number.isSafeInteger(raw.exportedAt) || (raw.exportedAt as number) < 0) {
    throw new FactoryError('INVALID_INPUT', 'exportedAt должен быть неотрицательным числом')
  }
  return {
    format: AGENT_MARKETPLACE_FORMAT,
    id: expectedId,
    exportedAt: raw.exportedAt as number,
    profile: parseProfile(raw.profile),
  }
}

function decodeUtf8(buffer: Buffer): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
    if (!Buffer.from(text, 'utf8').equals(buffer)) throw new Error('invalid utf8')
    return text
  } catch {
    throw new FactoryError('INVALID_INPUT', 'Agent file не является валидным UTF-8')
  }
}

/**
 * Root/operator service for portable agent profiles. It never resolves or
 * widens tools: allowedTools must be a subset of the caller's visible tools.
 */
export class AgentMarketplaceService {
  constructor(
    private readonly ctx: Context,
    private readonly runtime: FactoryRuntime,
  ) {}

  export(agentId: string, exec: ToolRunContext): AgentMarketplaceExport {
    const profile = this.runtime.agents.require(agentId)
    const portable = portableProfile(profile)
    const marketplaceId = slugify(profile.name)
    if (!FILE_ID_RE.test(marketplaceId)) throw new FactoryError('INVALID_INPUT', 'Не удалось построить marketplace id')
    const file: PortableFile = {
      format: AGENT_MARKETPLACE_FORMAT,
      id: marketplaceId,
      exportedAt: Date.now(),
      profile: portable,
    }
    for (const value of [portable.name, portable.title, portable.description, portable.systemInstruction]) {
      this.assertNoSecrets(value)
    }
    const json = `${JSON.stringify(file, null, 2)}\n`
    this.assertNoSecrets(json)
    const hash = createHash('sha256').update(json, 'utf8').digest('hex')
    this.writeFile(exec, marketplaceId, json)
    return { marketplaceId, relativePath: `.agents/${marketplaceId}.json`, hash, profile: portable }
  }

  validate(fileId: string, exec: ToolRunContext, nameOverride?: string): AgentMarketplaceValidation {
    try {
      const file = this.readFile(exec, fileId)
      const profile = file.profile
      const name = (nameOverride?.trim() || profile.name).trim()
      if (name === '' || name.length > 80) throw new FactoryError('INVALID_INPUT', 'name должен быть 1..80 символов')
      for (const value of [profile.name, profile.title, profile.description, profile.systemInstruction]) {
        this.assertNoSecrets(value)
      }
      const json = JSON.stringify(file)
      this.assertNoSecrets(json)
      const errors: string[] = []
      const warnings: string[] = []
      const project = this.runtime.projectFor(exec)
      const store = new SkillStore(project.rootPath)
      const missingSkills: string[] = []
      for (const id of profile.skills) {
        try {
          const skill = store.get(id)
          if (!skill.enabled) missingSkills.push(id)
        } catch {
          missingSkills.push(id)
        }
      }
      if (missingSkills.length > 0) errors.push(`missing or disabled skills: ${missingSkills.join(', ')}`)
      const callerTools = this.callerToolNames(exec)
      const missingAllowedTools = profile.allowedTools.filter((tool) => !callerTools.has(tool))
      if (missingAllowedTools.length > 0) errors.push(`allowedTools outside caller: ${missingAllowedTools.join(', ')}`)
      const callerAccess = this.runtime.agentAccessLevel(exec.agent?.id)
      if (accessRank(callerAccess) < accessRank(profile.accessLevel)) {
        errors.push(`accessLevel ${profile.accessLevel} is higher than caller ${callerAccess}`)
      }
      if (this.runtime.agents.list({ limit: 200 }).some((agent) => agent.name === name)) {
        warnings.push(`name ${name} already exists; import will fail unless name override is used`)
      }
      const code = missingAllowedTools.length > 0 || accessRank(callerAccess) < accessRank(profile.accessLevel)
        ? 'FORBIDDEN'
        : missingSkills.length > 0
          ? 'SKILL_NOT_FOUND'
          : errors.length > 0
            ? 'INVALID_INPUT'
            : ''
      return {
        valid: errors.length === 0,
        marketplaceId: file.id,
        name,
        code,
        message: errors.length === 0 ? 'valid' : errors.join('; '),
        errors,
        warnings,
        requestedAllowedTools: [...profile.allowedTools],
        missingAllowedTools,
        missingSkills,
        accessLevel: profile.accessLevel,
        profile,
      }
    } catch (error) {
      if (error instanceof FactoryError) {
        return {
          valid: false,
          marketplaceId: fileId,
          name: nameOverride?.trim() ?? '',
          code: error.code,
          message: error.message,
          errors: [error.message],
          warnings: [],
          requestedAllowedTools: [],
          missingAllowedTools: [],
          missingSkills: [],
          accessLevel: '',
          profile: null,
        }
      }
      throw error
    }
  }

  import(fileId: string, exec: ToolRunContext, nameOverride?: string): AgentMarketplaceImport {
    const validation = this.validate(fileId, exec, nameOverride)
    if (!validation.valid || validation.profile === null) {
      const code = validation.code === 'FORBIDDEN' || validation.code === 'SKILL_NOT_FOUND' || validation.code === 'SECRET_DETECTED'
        ? validation.code
        : 'INVALID_INPUT'
      throw new FactoryError(code, validation.message, {
        marketplaceId: fileId,
        errors: validation.errors,
        missingAllowedTools: validation.missingAllowedTools,
        missingSkills: validation.missingSkills,
      })
    }
    const name = validation.name
    if (this.runtime.agents.list({ limit: 200 }).some((agent) => agent.name === name)) {
      throw new FactoryError('CONFLICT', `Профиль с именем "${name}" уже существует; передайте name override`, {
        name,
      })
    }
    const profile = validation.profile
    const agent = this.runtime.agents.create({
      name,
      role: profile.role,
      title: profile.title,
      description: profile.description,
      systemInstruction: profile.systemInstruction,
      modelProvider: profile.modelProvider,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
      tools: profile.tools,
      allowedTools: profile.allowedTools,
      skills: profile.skills,
      accessLevel: profile.accessLevel,
      memoryScope: profile.memoryScope,
      limits: profile.limits,
      enabled: profile.enabled,
    })
    return { agent, marketplaceId: fileId }
  }

  private callerToolNames(exec: ToolRunContext): Set<string> {
    if (!exec.agent) throw new FactoryError('FORBIDDEN', 'Agent marketplace требует вызывающего агента')
    return new Set(this.ctx.tools.definitions(exec.agent).map((definition) => definition.name))
  }

  private assertNoSecrets(json: string): void {
    const findings = detectSecrets(json)
    if (findings.length > 0) {
      throw new FactoryError('SECRET_DETECTED', 'Agent file похож на секрет; экспорт/импорт отклонён', {
        kinds: findings.map((finding) => finding.name),
      })
    }
  }

  private agentsDirectory(exec: ToolRunContext): string {
    return join(this.runtime.projectFor(exec).rootPath, '.agents')
  }

  private readFile(exec: ToolRunContext, fileId: string): PortableFile {
    if (!FILE_ID_RE.test(fileId)) throw new FactoryError('INVALID_INPUT', 'fileId должен быть slug')
    const directory = this.agentsDirectory(exec)
    try {
      const stat = lstatSync(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new FactoryError('INVALID_INPUT', '.agents должен быть обычным каталогом')
    } catch (error) {
      if (isMissing(error)) throw new FactoryError('NOT_FOUND', `Agent file не найден: ${fileId}`, { fileId })
      throw error
    }
    const target = join(directory, `${fileId}.json`)
    let stat
    try {
      stat = lstatSync(target)
    } catch (error) {
      if (isMissing(error)) throw new FactoryError('NOT_FOUND', `Agent file не найден: ${fileId}`, { fileId })
      throw error
    }
    if (stat.isSymbolicLink()) throw new FactoryError('INVALID_INPUT', 'Symlink agent file запрещён')
    if (!stat.isFile()) throw new FactoryError('INVALID_INPUT', 'Agent file должен быть regular file')
    if (stat.size > MAX_FILE_BYTES) throw new FactoryError('INVALID_INPUT', 'Agent file превышает 128 KiB')
    const buffer = readFileSync(target)
    const text = decodeUtf8(buffer)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new FactoryError('INVALID_INPUT', 'Agent file содержит невалидный JSON')
    }
    return parsePortableFile(raw, fileId)
  }

  private writeFile(exec: ToolRunContext, fileId: string, json: string): void {
    if (!FILE_ID_RE.test(fileId)) throw new FactoryError('INVALID_INPUT', 'marketplace id должен быть slug')
    const directory = this.agentsDirectory(exec)
    try {
      const stat = lstatSync(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new FactoryError('INVALID_INPUT', '.agents должен быть обычным каталогом')
    } catch (error) {
      if (!isMissing(error)) throw error
      mkdirSync(directory, { recursive: true })
      const stat = lstatSync(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new FactoryError('INVALID_INPUT', '.agents должен быть обычным каталогом')
    }
    const target = join(directory, `${fileId}.json`)
    try {
      const existing = lstatSync(target)
      if (existing.isSymbolicLink()) throw new FactoryError('INVALID_INPUT', 'Symlink agent file запрещён')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_FILE_BYTES) throw new FactoryError('INVALID_INPUT', 'Agent file превышает 128 KiB')
    const temporary = join(dirname(target), `.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, json, { encoding: 'utf8', flag: 'wx' })
      renameSync(temporary, target)
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {
        // Best-effort cleanup.
      }
      throw error
    }
  }
}
