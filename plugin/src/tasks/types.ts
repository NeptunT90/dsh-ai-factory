export const TASK_STATUSES = [
  'NEW',
  'PLANNING',
  'READY',
  'RUNNING',
  'WAITING',
  'REVIEW',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_TERMINAL_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'CANCELLED']

export interface TaskRecord {
  readonly id: string
  readonly projectId: string
  readonly parentId: string | null
  readonly title: string
  readonly description: string
  readonly goal: string
  readonly status: TaskStatus
  readonly priority: number
  readonly createdBy: string
  readonly assignedAgentId: string | null
  readonly assignedRole: string | null
  readonly plan: unknown
  readonly dependencies: readonly string[]
  readonly dueAt: number | null
  readonly availableAt: number | null
  readonly attempts: number
  readonly maxAttempts: number
  readonly timeoutMs: number | null
  readonly result: string | null
  readonly error: string | null
  readonly metadata: Record<string, unknown>
  readonly version: number
  readonly leaseOwner: string | null
  readonly leaseUntil: number | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly startedAt: number | null
  readonly finishedAt: number | null
}

export interface TaskCreateInput {
  readonly projectId: string
  readonly title: string
  readonly description?: string
  readonly goal?: string
  readonly status?: TaskStatus
  readonly priority?: number
  readonly parentId?: string | null
  readonly assignedAgentId?: string | null
  readonly assignedRole?: string | null
  readonly plan?: unknown
  readonly dependencies?: readonly string[]
  readonly dueAt?: number | null
  readonly maxAttempts?: number
  readonly timeoutMs?: number | null
  readonly metadata?: Record<string, unknown>
  readonly createdBy?: string
}

export interface TaskUpdateInput {
  readonly title?: string
  readonly description?: string
  readonly goal?: string
  readonly priority?: number
  readonly assignedAgentId?: string | null
  readonly assignedRole?: string | null
  readonly dueAt?: number | null
  readonly maxAttempts?: number
  readonly timeoutMs?: number | null
  readonly plan?: unknown
  readonly metadata?: Record<string, unknown>
  readonly expectedVersion?: number
}

export interface TaskListFilter {
  readonly projectId: string
  readonly statuses?: readonly TaskStatus[]
  readonly assignedAgentId?: string
  readonly parentId?: string
  readonly includeTerminal?: boolean
  readonly limit?: number
}

export interface TaskEvent {
  readonly id: string
  readonly taskId: string
  readonly ts: number
  readonly type: string
  readonly actor: string | null
  readonly fromStatus: TaskStatus | null
  readonly toStatus: TaskStatus | null
  readonly data: Record<string, unknown>
}

export interface TaskStats {
  readonly projectId: string
  readonly total: number
  readonly active: number
  readonly ready: number
  readonly running: number
  readonly waiting: number
  readonly failed: number
  readonly completed: number
  readonly cancelled: number
  readonly overdue: number
  readonly byStatus: Readonly<Record<TaskStatus, number>>
}

export interface ClaimOptions {
  readonly owner: string
  readonly leaseMs?: number
  readonly actor?: string
}
