import { randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { FactoryError } from '../core/errors.js'
import { loadSkillBuffer } from './loader.js'
import { SKILL_LIMITS, type SkillRecord } from './types.js'
import { parseSkillSource, skillRelativePath, validateSkillId } from './validator.js'

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new FactoryError('SKILL_INVALID', message, details)
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

/**
 * Filesystem-backed project-local skill store.
 *
 * The project root is fixed for the lifetime of one store. All paths are
 * derived from a validated skill id, so callers cannot supply arbitrary paths.
 * Reads reject symlinks, non-regular files and invalid UTF-8; writes are
 * temp-file + rename and never touch anything outside `<root>/.skills`.
 */
export class SkillStore {
  private readonly root: string
  private readonly directory: string

  constructor(projectRoot: string) {
    this.root = resolve(projectRoot)
    this.directory = join(this.root, '.skills')
  }

  get skillsDirectory(): string {
    return this.directory
  }

  list(): SkillRecord[] {
    if (!this.ensureDirectory(false)) return []
    const entries = readdirSync(this.directory, { withFileTypes: true })
    const markdown = entries.filter((entry) => {
      if (entry.isSymbolicLink()) {
        invalid('Symlink в .skills запрещён', { file: join(this.directory, entry.name) })
      }
      if (entry.isDirectory()) {
        invalid('Подкаталоги внутри .skills запрещены', { file: join(this.directory, entry.name) })
      }
      if (!entry.isFile()) {
        invalid('Разрешены только regular files в .skills', { file: join(this.directory, entry.name) })
      }
      return entry.name.endsWith('.md')
    })
    if (markdown.length > SKILL_LIMITS.maxFiles) {
      throw new FactoryError(
        'SKILL_LIMIT_EXCEEDED',
        `В .skills больше ${SKILL_LIMITS.maxFiles} файлов`,
        { count: markdown.length, limit: SKILL_LIMITS.maxFiles },
      )
    }
    const records = markdown.map((entry) => {
      const id = entry.name.slice(0, -3)
      validateSkillId(id, 'filename')
      return this.readSkillFile(id)
    })
    const total = records.reduce((sum, record) => sum + record.bodyBytes, 0)
    if (total > SKILL_LIMITS.maxTotalBodyBytes) {
      throw new FactoryError(
        'SKILL_LIMIT_EXCEEDED',
        `Суммарный body навыков превышает ${SKILL_LIMITS.maxTotalBodyBytes} байт`,
        { totalBodyBytes: total, limit: SKILL_LIMITS.maxTotalBodyBytes },
      )
    }
    return records.sort((left, right) => left.id.localeCompare(right.id))
  }

  get(id: string): SkillRecord {
    validateSkillId(id)
    if (!this.ensureDirectory(false)) {
      throw new FactoryError('SKILL_NOT_FOUND', `Skill не найден: ${id}`, { id })
    }
    return this.readSkillFile(id)
  }

  create(id: string, source: string): SkillRecord {
    validateSkillId(id)
    const target = this.pathFor(id)
    const parsed = parseSkillSource(id, source, target)
    this.ensureDirectory(true)
    this.assertTargetAbsent(target)
    this.assertCapacity(id, parsed.bodyBytes)
    this.atomicWrite(target, source)
    return this.get(id)
  }

  update(id: string, source: string, expectedHash: string): SkillRecord {
    validateSkillId(id)
    const current = this.get(id)
    if (current.hash !== expectedHash) {
      throw new FactoryError('CONFLICT', 'Skill изменён с момента ожидаемой версии', {
        id,
        expectedHash,
        actualHash: current.hash,
      })
    }
    const target = this.pathFor(id)
    const parsed = parseSkillSource(id, source, target)
    this.assertCapacity(id, parsed.bodyBytes)
    this.atomicWrite(target, source)
    return this.get(id)
  }

  delete(id: string): void {
    const current = this.get(id)
    try {
      unlinkSync(current.filePath)
    } catch (error) {
      if (isMissing(error)) throw new FactoryError('SKILL_NOT_FOUND', `Skill не найден: ${id}`, { id })
      throw error
    }
  }

  relativePath(id: string): string {
    return skillRelativePath(id)
  }

  private pathFor(id: string): string {
    validateSkillId(id)
    return join(this.directory, `${id}.md`)
  }

  private ensureDirectory(create: boolean): boolean {
    try {
      const stat = lstatSync(this.directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        invalid('.skills должен быть обычным каталогом', { path: this.directory })
      }
      return true
    } catch (error) {
      if (!isMissing(error)) throw error
      if (!create) return false
      try {
        mkdirSync(this.directory, { recursive: true })
      } catch (mkdirError) {
        if (!isMissing(mkdirError)) throw mkdirError
      }
      return this.ensureDirectory(false)
    }
  }

  private assertTargetAbsent(target: string): void {
    try {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink()) invalid('Symlink skill-файла запрещён', { file: target })
      throw new FactoryError('CONFLICT', 'Skill уже существует', { file: target })
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }

  private assertCapacity(replacingId: string, newBodyBytes: number): void {
    const existing = this.list().filter((record) => record.id !== replacingId)
    if (existing.length + 1 > SKILL_LIMITS.maxFiles) {
      throw new FactoryError(
        'SKILL_LIMIT_EXCEEDED',
        `В .skills больше ${SKILL_LIMITS.maxFiles} файлов`,
        { count: existing.length + 1, limit: SKILL_LIMITS.maxFiles },
      )
    }
    const total = existing.reduce((sum, record) => sum + record.bodyBytes, 0) + newBodyBytes
    if (total > SKILL_LIMITS.maxTotalBodyBytes) {
      throw new FactoryError(
        'SKILL_LIMIT_EXCEEDED',
        `Суммарный body навыков превышает ${SKILL_LIMITS.maxTotalBodyBytes} байт`,
        { totalBodyBytes: total, limit: SKILL_LIMITS.maxTotalBodyBytes },
      )
    }
  }

  private readSkillFile(id: string): SkillRecord {
    const target = this.pathFor(id)
    let stat
    try {
      stat = lstatSync(target)
    } catch (error) {
      if (isMissing(error)) throw new FactoryError('SKILL_NOT_FOUND', `Skill не найден: ${id}`, { id })
      throw error
    }
    if (stat.isSymbolicLink()) invalid('Symlink skill-файла запрещён', { file: target })
    if (!stat.isFile()) invalid('Skill должен быть regular file', { file: target })
    if (stat.size > SKILL_LIMITS.maxBodyBytes + SKILL_LIMITS.maxFrontmatterBytes + 2) {
      throw new FactoryError('SKILL_TOO_LARGE', 'Skill-файл превышает допустимый размер', {
        file: target,
        fileBytes: stat.size,
        limitBytes: SKILL_LIMITS.maxBodyBytes + SKILL_LIMITS.maxFrontmatterBytes + 2,
      })
    }
    let buffer: Buffer
    try {
      buffer = readFileSync(target)
    } catch (error) {
      if (isMissing(error)) throw new FactoryError('SKILL_NOT_FOUND', `Skill не найден: ${id}`, { id })
      throw error
    }
    return loadSkillBuffer(id, buffer, target)
  }

  private atomicWrite(target: string, source: string): void {
    const temporary = join(this.directory, `.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, Buffer.from(source, 'utf8'), { flag: 'wx' })
      renameSync(temporary, target)
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {
        // Best-effort cleanup; the original error remains authoritative.
      }
      throw error
    }
  }
}
