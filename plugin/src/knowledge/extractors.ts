import { extname } from 'node:path'
import { FactoryError } from '../core/errors.js'
import { detectSecrets } from '../core/security.js'
import type { ExtractedText } from './types.js'

const MAX_TEXT_CHARS = 2_000_000
const PDF_TIMEOUT_MS = 20_000

function normalize(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function htmlText(buffer: Buffer): { text: string; title: string } {
  const raw = buffer.toString('utf8')
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]?.trim() ?? ''
  const text = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return { text: normalize(decodeEntities(text)), title: normalize(decodeEntities(title)) }
}

function titleFromPath(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? path
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; pages: number; warnings: string[] }> {
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new FactoryError('KNOWLEDGE_INVALID', 'Файл не является PDF')
  }
  // Encrypted PDFs carry an /Encrypt dictionary in the trailer. Reject them
  // before invoking pdf.js; the parser must never attempt password cracking.
  if (buffer.includes(Buffer.from('/Encrypt'))) {
    throw new FactoryError('KNOWLEDGE_ENCRYPTED', 'PDF защищён паролем/шифрованием')
  }
  let pdf: any
  const loading = import('pdfjs-dist/legacy/build/pdf.mjs').then(async (module) => {
    const task = module.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useWorkerFetch: false,
      useSystemFonts: true,
      disableFontFace: true,
    })
    return task.promise
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FactoryError('KNOWLEDGE_INVALID', 'PDF parsing timeout')), PDF_TIMEOUT_MS)
    timer.unref?.()
  })
  try {
    pdf = await Promise.race([loading, timeout])
  } catch (error) {
    if (error instanceof FactoryError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/password|encrypted/i.test(message)) throw new FactoryError('KNOWLEDGE_ENCRYPTED', 'PDF защищён паролем/шифрованием')
    throw new FactoryError('KNOWLEDGE_INVALID', `PDF не прочитан: ${message.slice(0, 300)}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item: { str?: string }) => item.str ?? '').join(' ')
      pages.push(text)
      if (pages.join('\n').length > MAX_TEXT_CHARS) throw new FactoryError('KNOWLEDGE_TOO_LARGE', 'PDF содержит слишком много текста')
    }
    return { text: normalize(pages.join('\n\n')), pages: pdf.numPages, warnings: [] }
  } finally {
    await pdf.cleanup?.()
  }
}

/**
 * Extract plain text from an allowlisted knowledge file. This function never
 * executes a document, follows links, decrypts PDFs or calls a network service.
 */
export async function extractKnowledgeText(
  path: string,
  buffer: Buffer,
  extension = extname(path).toLowerCase(),
): Promise<ExtractedText> {
  const title = titleFromPath(path)
  if (extension === '.docx') {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return { text: normalize(result.value), title, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', warnings: [] }
    } catch (error) {
      if (error instanceof FactoryError) throw error
      throw new FactoryError('KNOWLEDGE_INVALID', `DOCX не прочитан: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`)
    }
  }
  if (extension === '.pdf') {
    const result = await extractPdf(buffer)
    return { text: result.text, title, mime: 'application/pdf', pages: result.pages, warnings: result.warnings }
  }
  if (extension === '.html' || extension === '.htm') {
    const result = htmlText(buffer)
    return { text: result.text, title: result.title || title, mime: 'text/html', warnings: [] }
  }
  if (extension === '.json') {
    try {
      const parsed: unknown = JSON.parse(buffer.toString('utf8'))
      const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)
      return { text: normalize(text), title, mime: 'application/json', warnings: [] }
    } catch {
      throw new FactoryError('KNOWLEDGE_INVALID', 'JSON невалиден')
    }
  }
  if (extension === '.csv') {
    return { text: normalize(buffer.toString('utf8')), title, mime: 'text/csv', warnings: [] }
  }
  if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
    return { text: normalize(buffer.toString('utf8')), title, mime: extension === '.txt' ? 'text/plain' : 'text/markdown', warnings: [] }
  }
  throw new FactoryError('KNOWLEDGE_UNSUPPORTED', `Расширение не поддерживается: ${extension}`)
}

/** Detect secret-like content before indexing. */
export function assertKnowledgeTextSafe(text: string): void {
  if (detectSecrets(text).length > 0) {
    throw new FactoryError('KNOWLEDGE_INVALID', 'Документ содержит секретоподобный текст; индексация отклонена')
  }
}
