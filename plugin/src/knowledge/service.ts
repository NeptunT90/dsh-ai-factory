import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { FactoryError } from '../core/errors.js'
import { now } from '../core/ids.js'
import type { FactoryRuntime } from '../runtime.js'
import { assertKnowledgeTextSafe, extractKnowledgeText } from './extractors.js'
import { chunkKnowledgeText } from './chunker.js'
import { KnowledgeStore } from './store.js'
import type { KnowledgeAddResult, KnowledgeDocument, KnowledgeSearchHit } from './types.js'
import { KNOWLEDGE_EXTENSIONS } from './types.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 200
const MAX_CHUNKS = 500

function extensionOf(path: string): string {
  return extname(path).toLowerCase()
}

function allowedExtension(path: string): boolean {
  return (KNOWLEDGE_EXTENSIONS as readonly string[]).includes(extensionOf(path))
}

function hash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function assertRealPath(projectRoot: string, knowledgeRoot: string, candidate: string): string {
  let realProject: string
  let realKnowledge: string
  let realCandidate: string
  try {
    realProject = realpathSync(resolve(projectRoot))
    realKnowledge = realpathSync(resolve(knowledgeRoot))
    realCandidate = realpathSync(resolve(candidate))
  } catch {
    throw new FactoryError('INVALID_PATH', 'Не удалось разрешить физический путь knowledge')
  }
  if (!isInside(realProject, realKnowledge)) {
    throw new FactoryError('INVALID_PATH', 'knowledge физически находится вне project root')
  }
  if (!isInside(realKnowledge, realCandidate)) {
    throw new FactoryError('INVALID_PATH', 'Symlink выводит файл за пределы project/knowledge')
  }
  // Verify every path segment, not only the final file. A symlinked parent
  // directory outside the project must be rejected before any read.
  const rel = relative(resolve(knowledgeRoot), resolve(candidate))
  let current = realKnowledge
  for (const segment of rel.split(/[\\/]/).filter((part) => part !== '')) {
    current = join(current, segment)
    let realCurrent: string
    try {
      realCurrent = realpathSync(current)
    } catch {
      throw new FactoryError('INVALID_PATH', 'Родительский путь knowledge не разрешается')
    }
    if (!isInside(realKnowledge, realCurrent)) {
      throw new FactoryError('INVALID_PATH', 'Symlink в родительской папке knowledge запрещён')
    }
  }
  return realCandidate
}

function walk(root: string, target: string, recursive: boolean, projectRoot: string): string[] {
  assertRealPath(projectRoot, root, target)
  const stat = lstatSync(target)
  if (stat.isSymbolicLink()) throw new FactoryError('INVALID_PATH', 'Symlink в knowledge запрещён')
  if (stat.isFile()) {
    if (!allowedExtension(target)) throw new FactoryError('KNOWLEDGE_UNSUPPORTED', `Формат не поддерживается: ${extensionOf(target)}`)
    return [target]
  }
  if (!stat.isDirectory()) throw new FactoryError('KNOWLEDGE_INVALID', 'Путь не является файлом или папкой')
  if (!recursive) throw new FactoryError('INVALID_INPUT', 'Для папки укажите recursive=true')
  const result: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      assertRealPath(projectRoot, root, full)
      if (entry.isSymbolicLink()) throw new FactoryError('INVALID_PATH', `Symlink в knowledge запрещён: ${full}`)
      if (entry.isDirectory()) {
        visit(full)
        continue
      }
      if (entry.isFile() && allowedExtension(full)) {
        if (!isInside(root, full)) throw new FactoryError('INVALID_PATH', 'Путь вне knowledge отклонён')
        result.push(full)
        if (result.length > MAX_FILES) throw new FactoryError('KNOWLEDGE_TOO_LARGE', `Слишком много файлов (максимум ${MAX_FILES})`)
      }
    }
  }
  visit(target)
  return result
}

export class KnowledgeService {
  private readonly store: KnowledgeStore

  constructor(private readonly runtime: FactoryRuntime) {
    this.store = new KnowledgeStore(runtime.db)
  }

  async add(input: {
    projectId: string
    rootPath: string
    target: string
    recursive?: boolean
  }): Promise<KnowledgeAddResult> {
    const knowledgeRoot = join(input.rootPath, 'knowledge')
    const target = this.resolveTarget(knowledgeRoot, input.target, input.rootPath)
    const files = walk(knowledgeRoot, target, input.recursive === true, input.rootPath).slice(0, MAX_FILES)
    const errors: Array<{ path: string; code: string; message: string }> = []
    let indexed = 0
    let skipped = 0
    let failed = 0
    for (const file of files) {
      const relativePath = relative(input.rootPath, file).replace(/\\/g, '/')
      try {
        const realFile = assertRealPath(input.rootPath, knowledgeRoot, file)
        const stat = lstatSync(realFile)
        if (stat.isSymbolicLink()) throw new FactoryError('INVALID_PATH', 'Symlink запрещён')
        if (stat.size > MAX_FILE_BYTES) throw new FactoryError('KNOWLEDGE_TOO_LARGE', `Файл больше ${MAX_FILE_BYTES} байт`)
        const buffer = readFileSync(realFile)
        const fileHash = hash(buffer)
        const existing = this.store.findByPath(input.projectId, relativePath)
        if (existing?.status === 'INDEXED' && existing.sha256 === fileHash) {
          skipped += 1
          continue
        }
        const documentId = existing?.id ?? `kdoc_${randomUUID()}`
        this.store.beginDocument({
          id: documentId,
          projectId: input.projectId,
          path: relativePath,
          title: relativePath.split('/').pop() ?? relativePath,
          mime: null,
          size: stat.size,
          sha256: fileHash,
          metadata: { extension: extensionOf(file) },
        })
        try {
          const extracted = await extractKnowledgeText(realFile, buffer)
          assertKnowledgeTextSafe(extracted.text)
          const chunks = chunkKnowledgeText(extracted.text).slice(0, MAX_CHUNKS)
          if (chunks.length === 0) throw new FactoryError('KNOWLEDGE_INVALID', 'Нет текста для индексации')
          this.store.replaceChunks(documentId, input.projectId, chunks)
          indexed += 1
        } catch (error) {
          failed += 1
          const message = error instanceof Error ? error.message : String(error)
          const code = (error as { code?: string }).code ?? 'KNOWLEDGE_INVALID'
          this.store.markFailed(documentId, message)
          errors.push({ path: relativePath, code, message })
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        const code = (error as { code?: string }).code ?? 'KNOWLEDGE_INVALID'
        errors.push({ path: relativePath, code, message })
      }
    }
    return { documents: files.length, indexed, skipped, failed, errors }
  }

  search(projectId: string, query: string, limit = 8): KnowledgeSearchHit[] {
    if (query.trim() === '') throw new FactoryError('INVALID_INPUT', 'query не может быть пустым')
    return this.store.search(projectId, query, limit)
  }

  list(projectId: string, options: { status?: KnowledgeDocument['status']; limit?: number } = {}): KnowledgeDocument[] {
    return this.store.list(projectId, options)
  }

  delete(projectId: string, input: { documentId?: string; path?: string }): KnowledgeDocument {
    const document = input.documentId
      ? this.store.get(projectId, input.documentId)
      : input.path
        ? this.store.findByPath(projectId, input.path.replace(/\\/g, '/'))
        : undefined
    if (!document || document.status === 'DELETED') {
      throw new FactoryError('KNOWLEDGE_NOT_FOUND', 'Документ knowledge не найден')
    }
    this.store.delete(projectId, document.id)
    return this.store.get(projectId, document.id)!
  }

  count(projectId: string): { documents: number; chunks: number } {
    return this.store.count(projectId)
  }

  private resolveTarget(knowledgeRoot: string, target: string, projectRoot: string): string {
    const raw = target.trim()
    if (raw === '') throw new FactoryError('INVALID_INPUT', 'path не может быть пустым')
    const relativeTarget = raw.replace(/^knowledge(?:[\\/]|$)/, '')
    const candidate = isAbsolute(raw)
      ? resolve(raw)
      : relativeTarget === ''
        ? resolve(knowledgeRoot)
        : resolve(knowledgeRoot, relativeTarget)
    const root = resolve(knowledgeRoot)
    if (!isInside(root, candidate)) {
      throw new FactoryError('KNOWLEDGE_INVALID', 'Путь должен находиться внутри project/knowledge')
    }
    if (!existsSync(candidate)) throw new FactoryError('KNOWLEDGE_NOT_FOUND', `Путь не найден: ${target}`)
    return assertRealPath(projectRoot, knowledgeRoot, candidate)
  }
}
