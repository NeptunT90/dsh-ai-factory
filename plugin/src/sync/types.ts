/** Payload contract shared by the local outbox and the sync server. */
export interface RemoteMemoryPayload {
  readonly id: string
  readonly projectId: string | null
  readonly projectName: string | null
  readonly projectRoot: string | null
  readonly scope: 'project' | 'global'
  readonly kind: 'working' | 'episodic' | 'semantic' | 'project' | 'user'
  readonly title: string
  readonly content: string
  readonly tags: string[]
  readonly trust: 'verified' | 'user_confirmed' | 'unverified' | 'inferred'
  readonly confidence: number
  readonly sourceType: 'user' | 'agent' | 'tool' | 'import' | 'system'
  readonly sourceRef: string | null
  readonly agentId: string | null
  readonly sessionId: string | null
  readonly status: 'active' | 'superseded' | 'deleted'
  readonly version: number
  readonly supersedesId: string | null
  readonly metadata: Record<string, unknown>
  readonly createdAt: number
  readonly updatedAt: number
  readonly accessedAt: number | null
  readonly expiresAt: number | null
  readonly deletedAt: number | null
}

export interface OutboxRow {
  readonly opId: string
  readonly entityId: string
  readonly operation: 'upsert' | 'delete'
  readonly payload: RemoteMemoryPayload
  readonly baseVersion: number | null
  readonly createdAt: number
  readonly attempts: number
  readonly nextAttemptAt: number | null
  readonly lastError: string | null
}

export interface SyncPushResult {
  readonly pushed: number
  readonly accepted: number
  readonly conflicts: number
  readonly failed: number
  readonly pending: number
}

export interface SyncPullResult {
  readonly applied: number
  readonly skipped: number
  readonly cursor: string
}

export interface SyncStatus {
  readonly configured: boolean
  readonly url: string
  readonly tokenPresent: boolean
  readonly deviceId: string
  readonly cursor: string
  readonly pending: number
  readonly failed: number
  readonly lastError: string
}
