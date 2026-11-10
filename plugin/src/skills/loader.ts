import { FactoryError } from '../core/errors.js'
import { parseSkillSource } from './validator.js'
import type { SkillRecord } from './types.js'

/**
 * Decode a skill file as strict UTF-8, then run the pure validator.
 * Invalid byte sequences are rejected rather than silently replaced.
 */
export function loadSkillBuffer(id: string, buffer: Buffer, filePath: string): SkillRecord {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    throw new FactoryError('SKILL_INVALID', 'Skill-файл не является валидным UTF-8', { file: filePath })
  }
  if (!Buffer.from(source, 'utf8').equals(buffer)) {
    throw new FactoryError('SKILL_INVALID', 'Skill-файл не является валидным UTF-8', { file: filePath })
  }
  return parseSkillSource(id, source, filePath)
}
