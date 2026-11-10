import type { AgentRole } from '../agents/types.js'

/** The only accepted skill file format in BLOCK 3. */
export const SKILL_API_VERSION = 'factory.skill/v1'

/** Hard limits shared by the loader, validator and store. */
export const SKILL_LIMITS = {
  maxFiles: 50,
  maxBodyBytes: 16 * 1024,
  maxTotalBodyBytes: 64 * 1024,
  maxFrontmatterBytes: 4 * 1024,
  maxNameChars: 100,
  maxDescriptionChars: 500,
} as const

export interface SkillFrontmatter {
  readonly apiVersion: typeof SKILL_API_VERSION
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: number
  readonly roles: readonly AgentRole[]
  readonly priority: number
  readonly enabled: boolean
}

/** Parsed immutable view of one skill file. The body is never executable. */
export interface SkillRecord extends SkillFrontmatter {
  readonly body: string
  /** Absolute path inside the owning project's .skills directory. */
  readonly filePath: string
  /** Relative path such as .skills/code-review.md. */
  readonly relativePath: string
  /** SHA-256 over the whole UTF-8 file, used for optimistic updates. */
  readonly hash: string
  readonly bodyBytes: number
  readonly fileBytes: number
}

export interface SkillCreateResult {
  readonly skill: SkillRecord
}

export interface SkillDeleteResult {
  readonly id: string
  readonly deleted: true
}
