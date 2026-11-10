import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import { AGENT_ROLES, type AgentRole } from '../agents/types.js'
import { FactoryError } from '../core/errors.js'
import { detectSecrets } from '../core/security.js'
import { SKILL_API_VERSION, SKILL_LIMITS, type SkillRecord } from './types.js'

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const ALLOWED_KEYS = new Set([
  'apiVersion',
  'id',
  'name',
  'description',
  'version',
  'roles',
  'priority',
  'enabled',
])
const FORBIDDEN_KEYS = new Set(['allowedTools', 'tools', 'complete', 'order', 'systemPrompt', 'prompt'])

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new FactoryError('SKILL_INVALID', message, details)
}

/** Validate the id supplied by a caller or derived from a file name. */
export function validateSkillId(id: string, field = 'id'): void {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    invalid(`${field} должен соответствовать ^[a-z0-9][a-z0-9-]{1,63}$`, { field })
  }
}

export function skillRelativePath(id: string): string {
  validateSkillId(id)
  return `.skills/${id}.md`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateFrontmatter(raw: Record<string, unknown>, expectedId: string, relativePath: string): {
  frontmatter: {
    apiVersion: typeof SKILL_API_VERSION
    id: string
    name: string
    description: string
    version: number
    roles: readonly AgentRole[]
    priority: number
    enabled: boolean
  }
} {
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(key)) {
      invalid(`Поле "${key}" запрещено в skill frontmatter`, { file: relativePath, field: key })
    }
    if (!ALLOWED_KEYS.has(key)) {
      invalid(`Неизвестное поле skill frontmatter: "${key}"`, { file: relativePath, field: key })
    }
  }

  if (raw.apiVersion !== SKILL_API_VERSION) {
    invalid(`apiVersion должен быть ${SKILL_API_VERSION}`, { file: relativePath, field: 'apiVersion' })
  }
  if (raw.id !== expectedId) {
    invalid('frontmatter.id должен совпадать с именем файла', {
      file: relativePath,
      field: 'id',
      expectedId,
      actualId: raw.id,
    })
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (name === '' || name.length > SKILL_LIMITS.maxNameChars) {
    invalid(`name должен быть 1..${SKILL_LIMITS.maxNameChars} символов`, { file: relativePath, field: 'name' })
  }
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  if (description === '' || description.length > SKILL_LIMITS.maxDescriptionChars) {
    invalid(`description должен быть 1..${SKILL_LIMITS.maxDescriptionChars} символов`, {
      file: relativePath,
      field: 'description',
    })
  }
  if (!Number.isSafeInteger(raw.version) || (raw.version as number) < 1) {
    invalid('version должен быть целым числом >= 1', { file: relativePath, field: 'version' })
  }
  if (!Array.isArray(raw.roles) || raw.roles.length === 0) {
    invalid('roles должен быть непустым массивом ролей', { file: relativePath, field: 'roles' })
  }
  const roles: AgentRole[] = []
  for (const value of raw.roles) {
    if (typeof value !== 'string' || !(AGENT_ROLES as readonly string[]).includes(value)) {
      invalid(`Неизвестная роль: ${String(value)}`, { file: relativePath, field: 'roles' })
    }
    if (roles.includes(value as AgentRole)) {
      invalid(`Дубликат роли: ${value}`, { file: relativePath, field: 'roles' })
    }
    roles.push(value as AgentRole)
  }
  if (!Number.isSafeInteger(raw.priority) || (raw.priority as number) < 0 || (raw.priority as number) > 100) {
    invalid('priority должен быть целым числом 0..100', { file: relativePath, field: 'priority' })
  }
  if (typeof raw.enabled !== 'boolean') {
    invalid('enabled должен быть boolean', { file: relativePath, field: 'enabled' })
  }

  return {
    frontmatter: {
      apiVersion: SKILL_API_VERSION,
      id: expectedId,
      name,
      description,
      version: raw.version as number,
      roles,
      priority: raw.priority as number,
      enabled: raw.enabled,
    },
  }
}

/**
 * Parse and validate one already-decoded skill file.
 *
 * The returned record is immutable-by-convention: callers must persist the
 * original source through SkillStore to keep the hash and optimistic update
 * contract intact.
 */
export function parseSkillSource(expectedId: string, source: string, filePath: string): SkillRecord {
  validateSkillId(expectedId)
  const relativePath = skillRelativePath(expectedId)

  if (typeof source !== 'string' || source.length === 0) {
    invalid('Skill-файл пуст', { file: relativePath })
  }
  if (source.includes('\u0000') || CONTROL_RE.test(source)) {
    invalid('Skill-файл содержит NUL/бинарные control-символы', { file: relativePath })
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source)
  if (!match) {
    invalid('Отсутствует YAML frontmatter; файл должен начинаться с ---', { file: relativePath })
  }
  const frontmatterText = match[1] ?? ''
  const body = match[2] ?? ''
  if (Buffer.byteLength(frontmatterText, 'utf8') > SKILL_LIMITS.maxFrontmatterBytes) {
    throw new FactoryError('SKILL_TOO_LARGE', 'Skill frontmatter превышает 4 KiB', {
      file: relativePath,
      limitBytes: SKILL_LIMITS.maxFrontmatterBytes,
    })
  }
  if (body.trim() === '') {
    invalid('Skill body пуст', { file: relativePath })
  }
  const bodyBytes = Buffer.byteLength(body, 'utf8')
  if (bodyBytes < 1 || bodyBytes > SKILL_LIMITS.maxBodyBytes) {
    throw new FactoryError('SKILL_TOO_LARGE', `Skill body должен быть 1..${SKILL_LIMITS.maxBodyBytes} байт`, {
      file: relativePath,
      bodyBytes,
      limitBytes: SKILL_LIMITS.maxBodyBytes,
    })
  }

  let raw: unknown
  try {
    const document = parseDocument(frontmatterText, {
      uniqueKeys: true,
      prettyErrors: true,
      schema: 'core',
    })
    if (document.errors.length > 0) {
      invalid(`YAML frontmatter содержит ошибку: ${document.errors[0]?.message ?? 'parse error'}`, {
        file: relativePath,
      })
    }
    raw = document.toJS()
  } catch (error) {
    if (error instanceof FactoryError) throw error
    invalid('Не удалось разобрать YAML frontmatter', { file: relativePath })
  }
  if (!isPlainRecord(raw)) {
    invalid('YAML frontmatter должен быть mapping-объектом', { file: relativePath })
  }

  const { frontmatter } = validateFrontmatter(raw, expectedId, relativePath)
  const secrets = detectSecrets(body)
  if (secrets.length > 0) {
    throw new FactoryError(
      'SKILL_SECRET_DETECTED',
      'Skill body похож на секрет; сохраните санитизированное описание',
      { file: relativePath, kinds: secrets.map((finding) => finding.name) },
    )
  }

  return {
    ...frontmatter,
    body,
    filePath,
    relativePath,
    hash: createHash('sha256').update(source, 'utf8').digest('hex'),
    bodyBytes,
    fileBytes: Buffer.byteLength(source, 'utf8'),
  }
}
