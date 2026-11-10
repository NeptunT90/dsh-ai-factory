import type { ResolvedConfig } from '../config.js'
import { FactoryError } from '../core/errors.js'
import { newId, now } from '../core/ids.js'
import type { ProjectService } from '../projects/service.js'
import type { FactoryDatabase } from '../storage/database.js'
import type { AgentRegistry } from '../agents/registry.js'
import {
  TASK_STATUSES,
  type ClaimOptions,
  type TaskCreateInput,
  type TaskEvent,
  type TaskListFilter,
  type TaskRecord,
  type TaskStats,
  type TaskStatus,
  type TaskUpdateInput,
} from './types.js'

interface TaskRow {
  id: string
  project_id: string
  parent_id: string | null
  title: string
  description: string
  goal: string
  status: TaskStatus
  priority: number
  created_by: string
  assigned_agent_id: string | null
  assigned_role: string | null
  plan: string
  dependencies: string
  due_at: number | null
  available_at: number | null
  attempts: number
  max_attempts: number
  timeout_ms: number | null
  result: string | null
  error: string | null
  metadata: string
  version: number
  lease_owner: string | null
  lease_until: number | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

interface EventRow {
  id: string
  task_id: string
  ts: number
  type: string
  actor: string | null
  from_status: TaskStatus | null
  to_status: TaskStatus | null
  data: string
}

const STATUS_SET = new Set<string>(TASK_STATUSES)

function parseStringArray(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return []
  }
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    goal: row.goal,
    status: row.status,
    priority: row.priority,
    createdBy: row.created_by,
    assignedAgentId: row.assigned_agent_id,
    assignedRole: row.assigned_role,
    plan: parseJson(row.plan),
    dependencies: parseStringArray(row.dependencies),
    dueAt: row.due_at,
    availableAt: row.available_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    timeoutMs: row.timeout_ms,
    result: row.result,
    error: row.error,
    metadata: parseObject(row.metadata),
    version: row.version,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

const SELECT = `
  SELECT id, project_id, parent_id, title, description, goal, status, priority, created_by,
         assigned_agent_id, assigned_role, plan, dependencies, due_at, available_at, attempts,
         max_attempts, timeout_ms, result, error, metadata, version, lease_owner, lease_until,
         created_at, updated_at, started_at, finished_at
  FROM tasks`

function clampPriority(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 50
  return Math.max(0, Math.min(100, Math.floor(value)))
}

function clampAttempts(value: number | undefined, fallback = 3): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(10, Math.floor(value)))
}

function clampLease(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 15 * 60 * 1000
  return Math.max(10_000, Math.min(24 * 60 * 60 * 1000, Math.floor(value)))
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000)
}

/** Durable task queue with dependencies, leases, retry and recovery. */
export class TaskEngine {
  constructor(
    private readonly db: FactoryDatabase,
    private readonly projects: ProjectService,
    private readonly agents: AgentRegistry,
    private readonly config: ResolvedConfig,
  ) {}

  create(input: TaskCreateInput): TaskRecord {
    this.projects.require(input.projectId)
    const title = input.title.trim()
    if (title === '') throw new FactoryError('INVALID_INPUT', 'Название задачи не может быть пустым')
    if (title.length > 300) throw new FactoryError('INVALID_INPUT', 'Название задачи длиннее 300 символов')

    const dependencies = [...new Set((input.dependencies ?? []).map((id) => id.trim()).filter(Boolean))]
    for (const dependency of dependencies) {
      const row = this.db.get<{ id: string; project_id: string }>('SELECT id, project_id FROM tasks WHERE id = ?', [
        dependency,
      ])
      if (!row) throw new FactoryError('NOT_FOUND', `Зависимость не найдена: ${dependency}`)
      if (row.project_id !== input.projectId) {
        throw new FactoryError('INVALID_INPUT', `Зависимость ${dependency} принадлежит другому проекту`)
      }
    }

    const parentId = input.parentId?.trim() || null
    if (parentId) {
      const parent = this.db.get<{ project_id: string }>('SELECT project_id FROM tasks WHERE id = ?', [parentId])
      if (!parent) throw new FactoryError('NOT_FOUND', `Родительская задача не найдена: ${parentId}`)
      if (parent.project_id !== input.projectId) {
        throw new FactoryError('INVALID_INPUT', 'Родительская задача принадлежит другому проекту')
      }
    }

    const agent = input.assignedAgentId ? this.agents.require(input.assignedAgentId) : null
    if (agent && !agent.enabled) {
      throw new FactoryError('FORBIDDEN', `Профиль агента отключён: ${agent.name}`, { agentId: agent.id })
    }
    const maxAttempts = clampAttempts(input.maxAttempts, agent?.limits.maxAttempts ?? 3)
    const status: TaskStatus = input.status ?? (dependencies.length > 0 ? 'WAITING' : 'READY')
    if (!STATUS_SET.has(status)) throw new FactoryError('INVALID_INPUT', `Неизвестный статус: ${String(status)}`)
    if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED') {
      throw new FactoryError('INVALID_INPUT', 'Новая задача не может создаваться в терминальном статусе')
    }

    const plan = input.plan === undefined ? [] : input.plan
    const planText = JSON.stringify(plan)
    if (planText.length > 500_000) throw new FactoryError('INVALID_INPUT', 'План задачи превышает 500 KiB')
    const metadata = { autonomy: this.config.defaultAutonomy, ...(input.metadata ?? {}) }
    const metadataText = JSON.stringify(metadata)
    if (metadataText.length > 65_536) throw new FactoryError('INVALID_INPUT', 'metadata превышает 64 KiB')

    const id = newId('tsk')
    const ts = now()
    const priority = clampPriority(input.priority)
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO tasks
          (id, project_id, parent_id, title, description, goal, status, priority, created_by,
           assigned_agent_id, assigned_role, plan, dependencies, due_at, available_at, attempts,
           max_attempts, timeout_ms, result, error, metadata, version, lease_owner, lease_until,
           created_at, updated_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, ?, 1, NULL, NULL, ?, ?, NULL, NULL)`,
        [
          id,
          input.projectId,
          parentId,
          title,
          (input.description ?? '').slice(0, 100_000),
          (input.goal ?? title).slice(0, 100_000),
          status,
          priority,
          (input.createdBy ?? 'agent').slice(0, 200),
          agent?.id ?? null,
          input.assignedRole?.trim() || agent?.role || null,
          planText,
          JSON.stringify(dependencies),
          input.dueAt ?? null,
          ts,
          maxAttempts,
          input.timeoutMs ?? agent?.limits.timeoutMs ?? null,
          metadataText,
          ts,
          ts,
        ],
      )
      this.event(id, 'created', input.createdBy ?? 'agent', null, status, {
        dependencies,
        assignedAgentId: agent?.id ?? null,
      })
    })
    return this.require(id)
  }

  get(id: string): TaskRecord | undefined {
    const row = this.db.get<TaskRow>(`${SELECT} WHERE id = ?`, [id])
    return row ? mapTask(row) : undefined
  }

  require(id: string): TaskRecord {
    const task = this.get(id)
    if (!task) throw new FactoryError('NOT_FOUND', `Задача не найдена: ${id}`, { taskId: id })
    return task
  }

  list(filter: TaskListFilter): TaskRecord[] {
    this.projects.require(filter.projectId)
    const limit = Math.max(1, Math.min(200, Math.floor(filter.limit ?? 50)))
    const clauses = ['project_id = ?']
    const params: Array<string | number> = [filter.projectId]
    if (filter.statuses && filter.statuses.length > 0) {
      for (const status of filter.statuses) {
        if (!STATUS_SET.has(status)) throw new FactoryError('INVALID_INPUT', `Неизвестный статус: ${String(status)}`)
      }
      clauses.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`)
      params.push(...filter.statuses)
    } else if (!filter.includeTerminal) {
      clauses.push("status NOT IN ('COMPLETED', 'CANCELLED')")
    }
    if (filter.assignedAgentId) {
      clauses.push('assigned_agent_id = ?')
      params.push(filter.assignedAgentId)
    }
    if (filter.parentId) {
      clauses.push('parent_id = ?')
      params.push(filter.parentId)
    }
    return this.db
      .all<TaskRow>(
        `${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY priority DESC, created_at ASC LIMIT ?`,
        [...params, limit],
      )
      .map(mapTask)
  }

  update(id: string, input: TaskUpdateInput): TaskRecord {
    const current = this.require(id)
    if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
      throw new FactoryError('CONFLICT', `Задача в терминальном статусе ${current.status} не редактируется`)
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new FactoryError('VERSION_MISMATCH', `Ожидалась версия ${input.expectedVersion}, актуальная ${current.version}`, {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      })
    }
    const agent =
      input.assignedAgentId === undefined
        ? null
        : input.assignedAgentId
          ? this.agents.require(input.assignedAgentId)
          : null
    if (agent && !agent.enabled) throw new FactoryError('FORBIDDEN', `Профиль агента отключён: ${agent.name}`)
    const metadata = input.metadata === undefined ? current.metadata : { ...current.metadata, ...input.metadata }
    const metadataText = JSON.stringify(metadata)
    if (metadataText.length > 65_536) throw new FactoryError('INVALID_INPUT', 'metadata превышает 64 KiB')
    const planText = input.plan === undefined ? JSON.stringify(current.plan) : JSON.stringify(input.plan)
    if (planText.length > 500_000) throw new FactoryError('INVALID_INPUT', 'План задачи превышает 500 KiB')
    const assignedAgentId = input.assignedAgentId === undefined ? current.assignedAgentId : (agent?.id ?? null)
    const assignedRole =
      input.assignedRole === undefined ? (agent?.role ?? current.assignedRole) : input.assignedRole?.trim() || null
    const ts = now()
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks
         SET title = ?, description = ?, goal = ?, priority = ?, assigned_agent_id = ?, assigned_role = ?,
             plan = ?, due_at = ?, max_attempts = ?, timeout_ms = ?, metadata = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
        [
          input.title === undefined ? current.title : input.title.trim().slice(0, 300) || current.title,
          input.description === undefined ? current.description : input.description.slice(0, 100_000),
          input.goal === undefined ? current.goal : input.goal.slice(0, 100_000),
          input.priority === undefined ? current.priority : clampPriority(input.priority),
          assignedAgentId,
          assignedRole,
          planText,
          input.dueAt === undefined ? current.dueAt : input.dueAt,
          input.maxAttempts === undefined ? current.maxAttempts : clampAttempts(input.maxAttempts, current.maxAttempts),
          input.timeoutMs === undefined ? current.timeoutMs : input.timeoutMs,
          metadataText,
          ts,
          id,
        ],
      )
      this.event(id, 'updated', 'agent', null, null, {})
    })
    return this.require(id)
  }

  /** Atomically lease a READY task for one owner. */
  claim(id: string, options: ClaimOptions): TaskRecord {
    const owner = options.owner.trim()
    if (owner === '') throw new FactoryError('INVALID_INPUT', 'owner обязателен для claim')
    const leaseMs = clampLease(options.leaseMs)
    const ts = now()
    this.db.transaction(() => {
      const task = this.require(id)
      if (task.status !== 'READY') {
        throw new FactoryError('CONFLICT', `Задача ${id} не готова к запуску: ${task.status}`, { status: task.status })
      }
      if (task.availableAt !== null && task.availableAt > ts) {
        throw new FactoryError('CONFLICT', `Задача отложена до ${new Date(task.availableAt).toISOString()}`)
      }
      if (task.attempts >= task.maxAttempts) {
        throw new FactoryError('CONFLICT', `Исчерпаны попытки (${task.attempts}/${task.maxAttempts})`)
      }
      if (task.dependencies.length > 0) {
        const placeholders = task.dependencies.map(() => '?').join(', ')
        const rows = this.db.all<{ id: string; status: TaskStatus }>(
          `SELECT id, status FROM tasks WHERE id IN (${placeholders})`,
          [...task.dependencies],
        )
        const pending = rows.filter((row) => row.status !== 'COMPLETED').map((row) => row.id)
        if (pending.length > 0 || rows.length !== task.dependencies.length) {
          throw new FactoryError('CONFLICT', `Зависимости ещё не завершены: ${pending.join(', ') || 'отсутствуют'}`, {
            pending,
          })
        }
      }
      if (task.assignedAgentId) {
        const agent = this.agents.require(task.assignedAgentId)
        if (!agent.enabled) throw new FactoryError('FORBIDDEN', `Профиль агента отключён: ${agent.name}`)
        const running = this.db.get<{ n: number }>(
          "SELECT count(*) AS n FROM tasks WHERE assigned_agent_id = ? AND status = 'RUNNING'",
          [agent.id],
        )?.n ?? 0
        if (running >= agent.limits.maxConcurrentTasks) {
          throw new FactoryError('CONFLICT', `У агента ${agent.name} достигнут лимит параллельных задач`, {
            agentId: agent.id,
            running,
            limit: agent.limits.maxConcurrentTasks,
          })
        }
      }
      const leaseUntil = ts + leaseMs
      this.db.run(
        `UPDATE tasks
         SET status = 'RUNNING', attempts = attempts + 1, lease_owner = ?, lease_until = ?,
             started_at = ifnull(started_at, ?), version = version + 1, updated_at = ?
         WHERE id = ?`,
        [owner, leaseUntil, ts, ts, id],
      )
      this.event(id, 'claimed', options.actor ?? owner, 'READY', 'RUNNING', { owner, leaseUntil })
    })
    return this.require(id)
  }

  heartbeat(id: string, owner: string, leaseMs?: number): TaskRecord {
    const task = this.require(id)
    if (task.status !== 'RUNNING' || task.leaseOwner !== owner) {
      throw new FactoryError('CONFLICT', `Задача ${id} не удерживается владельцем ${owner}`)
    }
    const ts = now()
    const leaseUntil = ts + clampLease(leaseMs)
    this.db.run('UPDATE tasks SET lease_until = ?, updated_at = ? WHERE id = ?', [leaseUntil, ts, id])
    return this.require(id)
  }

  setPlan(id: string, plan: unknown, actor = 'agent'): TaskRecord {
    const task = this.require(id)
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new FactoryError('CONFLICT', 'Нельзя менять план терминальной задачи')
    }
    const planText = JSON.stringify(plan)
    if (planText.length > 500_000) throw new FactoryError('INVALID_INPUT', 'План задачи превышает 500 KiB')
    const ts = now()
    this.db.transaction(() => {
      this.db.run('UPDATE tasks SET plan = ?, version = version + 1, updated_at = ? WHERE id = ?', [planText, ts, id])
      this.event(id, 'plan_updated', actor, null, null, {})
    })
    return this.require(id)
  }

  submitForReview(id: string, actor: string, result: string | null = null): TaskRecord {
    const task = this.require(id)
    if (task.status !== 'RUNNING') throw new FactoryError('CONFLICT', `На ревью можно отправить RUNNING, сейчас ${task.status}`)
    const ts = now()
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks SET status = 'REVIEW', result = ?, lease_owner = NULL, lease_until = NULL,
         version = version + 1, updated_at = ? WHERE id = ?`,
        [result?.slice(0, 100_000) ?? null, ts, id],
      )
      this.event(id, 'review', actor, 'RUNNING', 'REVIEW', {})
    })
    return this.require(id)
  }

  complete(id: string, actor: string, result: string | null = null): TaskRecord {
    const task = this.require(id)
    if (task.status !== 'RUNNING' && task.status !== 'REVIEW') {
      throw new FactoryError('CONFLICT', `Завершить можно RUNNING или REVIEW, сейчас ${task.status}`)
    }
    const ts = now()
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks SET status = 'COMPLETED', result = ?, error = NULL, finished_at = ?,
         lease_owner = NULL, lease_until = NULL, version = version + 1, updated_at = ? WHERE id = ?`,
        [result?.slice(0, 100_000) ?? null, ts, ts, id],
      )
      this.event(id, 'completed', actor, task.status, 'COMPLETED', {})
      this.promoteLocked(task.projectId)
    })
    return this.require(id)
  }

  /**
   * Close the original FAILED task after its fix task passed review.
   * Ordinary complete() intentionally refuses FAILED; this explicit transition
   * keeps the original task's history while marking the outcome COMPLETED.
   */
  completeFixed(id: string, actor: string, result: string | null = null): TaskRecord {
    const task = this.require(id)
    if (task.status !== 'FAILED') {
      throw new FactoryError('CONFLICT', `Завершить после fix можно только FAILED, сейчас ${task.status}`)
    }
    const ts = now()
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks SET status = 'COMPLETED', result = ?, error = NULL, finished_at = ?,
         lease_owner = NULL, lease_until = NULL, version = version + 1, updated_at = ? WHERE id = ?`,
        [result?.slice(0, 100_000) ?? null, ts, ts, id],
      )
      this.event(id, 'completed_after_fix', actor, 'FAILED', 'COMPLETED', {})
      this.promoteLocked(task.projectId)
    })
    return this.require(id)
  }

  fail(id: string, actor: string, error: string, retryable = true): TaskRecord {
    const task = this.require(id)
    if (!['RUNNING', 'REVIEW', 'WAITING'].includes(task.status)) {
      throw new FactoryError('CONFLICT', `Нельзя зафиксировать ошибку для статуса ${task.status}`)
    }
    const ts = now()
    const shouldRetry = retryable && task.attempts < task.maxAttempts
    const next = shouldRetry ? 'READY' : 'FAILED'
    const availableAt = shouldRetry ? ts + retryDelayMs(task.attempts) : null
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks SET status = ?, error = ?, available_at = ?, lease_owner = NULL, lease_until = NULL,
         finished_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [next, error.slice(0, 20_000), availableAt, shouldRetry ? null : ts, ts, id],
      )
      this.event(id, shouldRetry ? 'retry_scheduled' : 'failed', actor, task.status, next, {
        retryable,
        attempts: task.attempts,
        maxAttempts: task.maxAttempts,
        availableAt,
      })
    })
    return this.require(id)
  }

  cancel(id: string, actor: string, reason = ''): TaskRecord {
    const task = this.require(id)
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new FactoryError('CONFLICT', `Задача уже ${task.status}`)
    }
    const ts = now()
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks SET status = 'CANCELLED', error = ?, lease_owner = NULL, lease_until = NULL,
         finished_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [reason.slice(0, 20_000) || null, ts, ts, id],
      )
      this.event(id, 'cancelled', actor, task.status, 'CANCELLED', { reason })
    })
    return this.require(id)
  }

  retry(id: string, actor: string): TaskRecord {
    const task = this.require(id)
    if (task.status !== 'FAILED') throw new FactoryError('CONFLICT', `Повторить можно только FAILED, сейчас ${task.status}`)
    const ts = now()
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks SET status = 'READY', error = NULL, available_at = ?, lease_owner = NULL,
         lease_until = NULL, finished_at = NULL, max_attempts = max_attempts + 1,
         version = version + 1, updated_at = ? WHERE id = ?`,
        [ts, ts, id],
      )
      this.event(id, 'retry_manual', actor, 'FAILED', 'READY', { extendedBudget: true })
    })
    return this.require(id)
  }

  /** Recover RUNNING tasks whose lease expired (crash/restart). */
  recoverStale(nowTs = now()): number {
    const stale = this.db.all<TaskRow>(
      `${SELECT} WHERE status = 'RUNNING' AND (lease_until IS NULL OR lease_until <= ?)`,
      [nowTs],
    )
    if (stale.length === 0) return 0
    this.db.transaction(() => {
      for (const row of stale) {
        const task = mapTask(row)
        const shouldRetry = task.attempts < task.maxAttempts
        const next: TaskStatus = shouldRetry ? 'READY' : 'FAILED'
        const availableAt = shouldRetry ? nowTs + retryDelayMs(task.attempts) : null
        this.db.run(
          `UPDATE tasks SET status = ?, error = 'lease expired', available_at = ?, lease_owner = NULL,
           lease_until = NULL, finished_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
          [next, availableAt, shouldRetry ? null : nowTs, nowTs, task.id],
        )
        this.event(task.id, 'lease_expired', 'system', 'RUNNING', next, {
          attempts: task.attempts,
          maxAttempts: task.maxAttempts,
        })
      }
    })
    return stale.length
  }

  events(id: string, limit = 50): TaskEvent[] {
    this.require(id)
    return this.db
      .all<EventRow>(
        `SELECT id, task_id, ts, type, actor, from_status, to_status, data
         FROM task_events WHERE task_id = ? ORDER BY ts DESC LIMIT ?`,
        [id, Math.max(1, Math.min(200, Math.floor(limit)))],
      )
      .map((row) => ({
        id: row.id,
        taskId: row.task_id,
        ts: row.ts,
        type: row.type,
        actor: row.actor,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        data: parseObject(row.data),
      }))
  }

  children(parentId: string): TaskRecord[] {
    return this.db
      .all<TaskRow>(`${SELECT} WHERE parent_id = ? ORDER BY created_at ASC`, [parentId])
      .map(mapTask)
  }

  stats(projectId: string): TaskStats {
    this.projects.require(projectId)
    const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>
    for (const row of this.db.all<{ status: TaskStatus; n: number }>(
      'SELECT status, count(*) AS n FROM tasks WHERE project_id = ? GROUP BY status',
      [projectId],
    )) {
      byStatus[row.status] = row.n
    }
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0)
    const active = total - byStatus.COMPLETED - byStatus.CANCELLED
    const overdue =
      this.db.get<{ n: number }>(
        `SELECT count(*) AS n FROM tasks WHERE project_id = ? AND due_at IS NOT NULL AND due_at < ?
         AND status NOT IN ('COMPLETED', 'CANCELLED')`,
        [projectId, now()],
      )?.n ?? 0
    return {
      projectId,
      total,
      active,
      ready: byStatus.READY,
      running: byStatus.RUNNING,
      waiting: byStatus.WAITING,
      failed: byStatus.FAILED,
      completed: byStatus.COMPLETED,
      cancelled: byStatus.CANCELLED,
      overdue,
      byStatus,
    }
  }

  /** Recent tasks across every project, newest activity first. */
  listAll(limit = 50): TaskRecord[] {
    const capped = Math.max(1, Math.min(200, Math.floor(limit)))
    return this.db
      .all<TaskRow>(`${SELECT} ORDER BY updated_at DESC LIMIT ?`, [capped])
      .map(mapTask)
  }

  /** Aggregate task statistics across every project. */
  statsAll(): TaskStats {
    const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>
    for (const row of this.db.all<{ status: TaskStatus; n: number }>(
      'SELECT status, count(*) AS n FROM tasks GROUP BY status',
    )) {
      byStatus[row.status] = row.n
    }
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0)
    const overdue =
      this.db.get<{ n: number }>(
        `SELECT count(*) AS n FROM tasks WHERE due_at IS NOT NULL AND due_at < ?
         AND status NOT IN ('COMPLETED', 'CANCELLED')`,
        [now()],
      )?.n ?? 0
    return {
      projectId: '*',
      total,
      active: total - byStatus.COMPLETED - byStatus.CANCELLED,
      ready: byStatus.READY,
      running: byStatus.RUNNING,
      waiting: byStatus.WAITING,
      failed: byStatus.FAILED,
      completed: byStatus.COMPLETED,
      cancelled: byStatus.CANCELLED,
      overdue,
      byStatus,
    }
  }

  count(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM tasks')?.n ?? 0
  }

  private promoteLocked(projectId: string): void {
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const waiting = this.db.all<TaskRow>(
        `${SELECT} WHERE project_id = ? AND status = 'WAITING' ORDER BY created_at ASC`,
        [projectId],
      )
      let changed = 0
      for (const row of waiting) {
        const task = mapTask(row)
        if (task.dependencies.length === 0) {
          this.promoteOne(task)
          changed += 1
          continue
        }
        const placeholders = task.dependencies.map(() => '?').join(', ')
        const deps = this.db.all<{ status: TaskStatus }>(
          `SELECT status FROM tasks WHERE id IN (${placeholders})`,
          [...task.dependencies],
        )
        if (deps.length === task.dependencies.length && deps.every((dep) => dep.status === 'COMPLETED')) {
          this.promoteOne(task)
          changed += 1
        }
      }
      if (changed === 0) return
    }
  }

  private promoteOne(task: TaskRecord): void {
    const ts = now()
    this.db.run("UPDATE tasks SET status = 'READY', available_at = ?, version = version + 1, updated_at = ? WHERE id = ?", [
      ts,
      ts,
      task.id,
    ])
    this.event(task.id, 'promoted', 'system', 'WAITING', 'READY', {})
  }

  private event(
    taskId: string,
    type: string,
    actor: string | null,
    from: TaskStatus | null,
    to: TaskStatus | null,
    data: Record<string, unknown>,
  ): void {
    this.db.run(
      `INSERT INTO task_events (id, task_id, ts, type, actor, from_status, to_status, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('evt'), taskId, now(), type.slice(0, 80), actor?.slice(0, 200) ?? null, from, to, JSON.stringify(data)],
    )
  }
}

export { retryDelayMs }
