import { createHash } from 'node:crypto'
import { FactoryError } from '../core/errors.js'
import type { KnowledgeChunkInput } from './types.js'

const TARGET_CHARS = 1000
const MAX_CHARS = 1200
const OVERLAP_CHARS = 150

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function headingOf(block: string): string | undefined {
  const match = /^(#{1,6})[ \t]+(.+)$/m.exec(block)
  return match?.[2]?.trim() || undefined
}

function splitLong(block: string): string[] {
  const parts: string[] = []
  let cursor = 0
  while (cursor < block.length) {
    let end = Math.min(block.length, cursor + MAX_CHARS)
    if (end < block.length) {
      const boundary = Math.max(block.lastIndexOf('\n', end), block.lastIndexOf('. ', end), block.lastIndexOf(' ', end))
      if (boundary > cursor + TARGET_CHARS) end = boundary + (block[boundary] === '.' ? 1 : 0)
    }
    const piece = block.slice(cursor, end).trim()
    if (piece !== '') parts.push(piece)
    if (end >= block.length) break
    cursor = Math.max(end - OVERLAP_CHARS, cursor + 1)
  }
  return parts
}

/** Split normalized text into 800–1200 char chunks with heading context. */
export function chunkKnowledgeText(text: string): KnowledgeChunkInput[] {
  const normalized = text.trim()
  if (normalized === '') throw new FactoryError('KNOWLEDGE_INVALID', 'Документ не содержит текста')
  const rawBlocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  let heading = ''
  const flush = (): void => {
    const value = current.trim()
    if (value !== '') chunks.push(value)
    current = ''
  }
  for (const block of rawBlocks) {
    const found = headingOf(block)
    if (found) heading = found
    if (block.length > MAX_CHARS) {
      flush()
      for (const piece of splitLong(block)) chunks.push(piece)
      continue
    }
    const candidate = current === '' ? block : `${current}\n\n${block}`
    if (candidate.length > MAX_CHARS) {
      flush()
      current = block
    } else {
      current = candidate
    }
    if (current.length >= TARGET_CHARS) flush()
  }
  flush()
  if (chunks.length === 0) throw new FactoryError('KNOWLEDGE_INVALID', 'Не удалось разбить документ на чанки')
  let cursor = 0
  return chunks.map((chunk, ordinal) => {
    const start = normalized.indexOf(chunk, cursor)
    const charStart = start >= 0 ? start : cursor
    cursor = charStart + chunk.length
    const headingLine = headingOf(chunk)
    return {
      ordinal,
      heading: headingLine ?? heading,
      text: chunk,
      charStart,
      charEnd: charStart + chunk.length,
      tokenEstimate: Math.ceil(chunk.length / 4),
      contentHash: digest(chunk),
    }
  })
}
