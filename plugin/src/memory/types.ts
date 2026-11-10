export const MEMORY_KINDS = ['working', 'episodic', 'semantic', 'project', 'user'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_SCOPES = ['project', 'global'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export const MEMORY_TRUST_LEVELS = ['verified', 'user_confirmed', 'unverified', 'inferred'] as const
export type MemoryTrust = (typeof MEMORY_TRUST_LEVELS)[number]

export const MEMORY_SOURCE_TYPES = ['user', 'agent', 'tool', 'import', 'system'] as const
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number]

export const MEMORY_STATUSES = ['active', 'superseded', 'deleted'] as const
export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

/** One durable memory record as stored and returned by tools. */
export interface MemoryRecord {
  readonly id: string
  readonly projectId: string | null
  readonly scope: MemoryScope
  readonly kind: MemoryKind
  readonly title: string
  readonly content: string
  readonly tags: readonly string[]
  readonly trust: MemoryTrust
  readonly confidence: number
  readonly sourceType: MemorySourceType
  readonly sourceRef: string | null
  readonly agentId: string | null
  readonly sessionId: string | null
  readonly status: MemoryStatus
  readonly version: number
  readonly supersedesId: string | null
  readonly metadata: Record<string, unknown>
  readonly accessCount: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly accessedAt: number | null
  readonly expiresAt: number | null
  readonly deletedAt: number | null
}

/** Input accepted by MemoryEngine.remember. */
export interface RememberInput {
  readonly content: string
  readonly title?: string
  readonly kind?: MemoryKind
  readonly scope?: MemoryScope
  readonly projectId?: string | null
  readonly tags?: readonly string[]
  readonly trust?: MemoryTrust
  readonly confidence?: number
  readonly sourceType?: MemorySourceType
  readonly sourceRef?: string
  readonly agentId?: string
  readonly sessionId?: string
  readonly metadata?: Record<string, unknown>
  /** TTL in hours; 0 disables expiry for this entry. */
  readonly ttlHours?: number
  /** Mark an older entry as superseded by this one. */
  readonly supersedesId?: string
  /** Attribution for audit and version history. */
  readonly actor?: string
}

export interface RememberResult {
  readonly entry: MemoryRecord
  readonly deduplicated: boolean
}

/** Filter accepted by MemoryEngine.search. */
export interface MemorySearchInput {
  readonly query?: string
  readonly projectId?: string | null
  readonly includeGlobal?: boolean
  readonly kinds?: readonly MemoryKind[]
  readonly scope?: MemoryScope
  readonly tags?: readonly string[]
  /** 0..1; default 0. */
  readonly minConfidence?: number
  readonly limit?: number
}

export interface MemorySearchHit {
  readonly id: string
  readonly projectId: string | null
  readonly scope: MemoryScope
  readonly kind: MemoryKind
  readonly title: string
  readonly snippet: string
  readonly score: number
  readonly trust: MemoryTrust
  readonly confidence: number
  readonly tags: readonly string[]
  readonly updatedAt: number
}

/** One historical snapshot (the state before a mutation). */
export interface MemoryVersion {
  readonly version: number
  readonly changedBy: string
  readonly changeReason: string | null
  readonly createdAt: number
  readonly snapshot: MemoryRecord
}

/** Input accepted by MemoryEngine.update. */
export interface MemoryUpdateInput {
  readonly id: string
  readonly title?: string
  readonly content?: string
  readonly tags?: readonly string[]
  readonly trust?: MemoryTrust
  readonly confidence?: number
  readonly metadata?: Record<string, unknown>
  /** TTL in hours; 0 removes expiry. Omit to keep the current value. */
  readonly ttlHours?: number
  /** Optimistic concurrency guard. */
  readonly expectedVersion?: number
  readonly actor?: string
  readonly reason?: string
}

export interface MemoryStats {
  readonly totalEntries: number
  readonly activeEntries: number
  readonly byKind: Readonly<Record<MemoryKind, number>>
  readonly byScope: Readonly<Record<MemoryScope, number>>
  readonly projects: number
  readonly versions: number
  readonly auditEvents: number
  readonly dbBytes: number
}
