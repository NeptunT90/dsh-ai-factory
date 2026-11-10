import { FactoryError } from '../core/errors.js'
import type { AgentRegistry } from '../agents/registry.js'
import type { ProjectService } from '../projects/service.js'
import { SkillStore } from './store.js'
import type { SkillRecord } from './types.js'

/**
 * Resolve a profile's project-local skill ids into validated snapshots.
 *
 * Fail-closed contract: every assigned skill must exist, parse, and be enabled.
 * A missing, invalid or disabled skill is reported as SKILL_NOT_FOUND so the
 * caller aborts before claim/child creation instead of silently changing the
 * agent's instructions.
 */
export class SkillService {
  constructor(
    private readonly projects: ProjectService,
    private readonly agents: AgentRegistry,
  ) {}

  resolve(profileId: string, projectId: string): SkillRecord[] {
    const profile = this.agents.require(profileId)
    const ids = [...new Set(profile.skills.map((id) => id.trim()).filter((id) => id !== ''))]
    if (ids.length === 0) return []

    const project = this.projects.require(projectId)
    const store = new SkillStore(project.rootPath)
    const skills: SkillRecord[] = []
    for (const id of ids) {
      let skill: SkillRecord
      try {
        skill = store.get(id)
      } catch (error) {
        if (error instanceof FactoryError) {
          throw new FactoryError(
            'SKILL_NOT_FOUND',
            `Навык ${id} профиля ${profile.name} недоступен в проекте ${project.name}`,
            {
              profileId,
              projectId,
              skillId: id,
              reason: error.code,
            },
          )
        }
        throw error
      }
      if (!skill.enabled) {
        throw new FactoryError(
          'SKILL_NOT_FOUND',
          `Навык ${id} профиля ${profile.name} отключён`,
          { profileId, projectId, skillId: id, reason: 'disabled' },
        )
      }
      skills.push(skill)
    }
    return skills
  }
}
