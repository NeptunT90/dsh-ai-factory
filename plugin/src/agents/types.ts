export const AGENT_ROLES = [
  'director',
  'researcher',
  'developer',
  'sysadmin',
  'analyst',
  'executor',
  'reviewer',
  'custom',
] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export const ACCESS_LEVELS = ['read', 'workspace', 'elevated', 'trusted'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

export const EGRESS_LEVELS = ['none', 'read', 'write'] as const
export type EgressLevel = (typeof EGRESS_LEVELS)[number]

export const MEMORY_SCOPES = ['project', 'global', 'both'] as const
export type AgentMemoryScope = (typeof MEMORY_SCOPES)[number]

export interface AgentLimits {
  /** Maximum number of tasks this profile may hold in RUNNING at once. */
  maxConcurrentTasks: number
  /** Default attempts for tasks assigned to this profile. */
  maxAttempts: number
  /** Default cooperative timeout in milliseconds. */
  timeoutMs: number
  /** Advisory autonomy ceiling; the deployment policy still decides approvals. */
  autonomy: 'safe' | 'autonomous' | 'trusted'
}

export interface AgentProfile {
  readonly id: string
  readonly name: string
  readonly role: AgentRole
  readonly title: string
  readonly description: string
  readonly systemInstruction: string
  readonly modelProvider: string | null
  readonly model: string | null
  readonly reasoningEffort: string | null
  /** Recommended tool names or glob patterns (advisory). */
  readonly tools: readonly string[]
  /** Exact model-facing tool allowlist enforced for child agents. */
  readonly allowedTools: readonly string[]
  /** Project-local .skills ids assigned to this profile. */
  readonly skills: readonly string[]
  readonly accessLevel: AccessLevel
  /** Network egress policy: none/read/write. */
  readonly egress: EgressLevel
  readonly memoryScope: AgentMemoryScope
  readonly limits: AgentLimits
  readonly enabled: boolean
  readonly isBuiltin: boolean
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface AgentCreateInput {
  readonly name: string
  readonly role?: AgentRole
  readonly title?: string
  readonly description?: string
  readonly systemInstruction?: string
  readonly modelProvider?: string | null
  readonly model?: string | null
  readonly reasoningEffort?: string | null
  readonly tools?: readonly string[]
  readonly allowedTools?: readonly string[]
  readonly skills?: readonly string[]
  readonly accessLevel?: AccessLevel
  readonly egress?: EgressLevel
  readonly memoryScope?: AgentMemoryScope
  readonly limits?: Partial<AgentLimits>
  readonly enabled?: boolean
}

export interface AgentUpdateInput {
  readonly name?: string
  readonly role?: AgentRole
  readonly title?: string
  readonly description?: string
  readonly systemInstruction?: string
  readonly modelProvider?: string | null
  readonly model?: string | null
  readonly reasoningEffort?: string | null
  readonly tools?: readonly string[]
  readonly allowedTools?: readonly string[]
  readonly skills?: readonly string[]
  readonly accessLevel?: AccessLevel
  readonly egress?: EgressLevel
  readonly memoryScope?: AgentMemoryScope
  readonly limits?: Partial<AgentLimits>
  readonly enabled?: boolean
  readonly expectedVersion?: number
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxConcurrentTasks: 2,
  maxAttempts: 3,
  timeoutMs: 15 * 60 * 1000,
  autonomy: 'autonomous',
}
