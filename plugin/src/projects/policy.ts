import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import { workspaceRootOf } from '../core/workspace.js'
import type { ProjectRecord, ProjectService } from './service.js'
import type { TaskRecord } from '../tasks/types.js'
import type { MemoryRecord } from '../memory/types.js'

export type ProjectOperation =
  | 'read'
  | 'write'
  | 'delete'
  | 'dispatch'
  | 'review'
  | 'workflow'
  | 'recover'
  | 'sync'

/**
 * Caller-project authorization for tools and child creation.
 *
 * Project ids are workspace identities, not user identities. Default policy is
 * deny-by-default: an operation may only touch the project derived from the
 * caller's session cwd. Global memory is a separate explicit exception.
 */
export class ProjectScopeService {
  constructor(
    private readonly projects: ProjectService,
    private readonly allowGlobalMemory = true,
  ) {}

  current(exec: Pick<ToolRunContext, 'agent'> | undefined): ProjectRecord {
    return this.projects.ensure(workspaceRootOf(exec))
  }

  requireSame(
    exec: Pick<ToolRunContext, 'agent'>,
    projectId: string,
    operation: ProjectOperation,
  ): ProjectRecord {
    const current = this.current(exec)
    if (projectId !== current.id) {
      throw new FactoryError(
        'PROJECT_MISMATCH',
        `Проект ${projectId} не совпадает с текущим проектом ${current.id}; операция ${operation} запрещена`,
        { currentProjectId: current.id, targetProjectId: projectId, operation },
      )
    }
    return current
  }

  assertTask(
    exec: Pick<ToolRunContext, 'agent'>,
    task: Pick<TaskRecord, 'id' | 'projectId'>,
    operation: ProjectOperation,
    allowCrossProject = false,
  ): void {
    if (allowCrossProject) return
    const current = this.current(exec)
    if (task.projectId !== current.id) {
      throw new FactoryError(
        'PROJECT_MISMATCH',
        `Задача ${task.id} принадлежит проекту ${task.projectId}, текущий проект ${current.id}; операция ${operation} запрещена`,
        { currentProjectId: current.id, targetProjectId: task.projectId, taskId: task.id, operation },
      )
    }
  }

  /**
   * Global memory is readable across projects when configured. Mutating a
   * global record is allowed only by an explicit caller-level policy; project
   * memory always requires the current project.
   */
  assertMemory(
    exec: Pick<ToolRunContext, 'agent'>,
    entry: Pick<MemoryRecord, 'id' | 'projectId'>,
    operation: 'read' | 'write' | 'delete',
  ): void {
    if (entry.projectId === null) {
      if (operation === 'read' && this.allowGlobalMemory) return
      if (this.allowGlobalMemory && operation !== 'read') return
      throw new FactoryError(
        'PROJECT_MISMATCH',
        `Глобальная память ${entry.id} недоступна для операции ${operation}`,
        { memoryId: entry.id, operation },
      )
    }
    const current = this.current(exec)
    if (entry.projectId !== current.id) {
      throw new FactoryError(
        'PROJECT_MISMATCH',
        `Запись памяти ${entry.id} принадлежит проекту ${entry.projectId}, текущий проект ${current.id}; операция ${operation} запрещена`,
        { currentProjectId: current.id, targetProjectId: entry.projectId, memoryId: entry.id, operation },
      )
    }
  }
}
