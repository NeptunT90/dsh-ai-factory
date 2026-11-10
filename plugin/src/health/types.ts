/** Tool-health vocabulary for the AI Factory overlay. */
export const TOOL_HEALTH_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'UNAVAILABLE',
  'UNKNOWN',
  'DISABLED',
  'REGISTERED',
  'NOT_TESTABLE',
] as const
export type ToolHealthStatus = (typeof TOOL_HEALTH_STATUSES)[number]

export const TOOL_RISKS = ['R0', 'R1', 'R2'] as const
export type ToolRisk = (typeof TOOL_RISKS)[number]

/** R0 can be probed; observed R0 has a hidden write and stays UNKNOWN. */
export type ProbeMode = 'probe' | 'observed' | 'schema' | 'not_testable'

export interface ToolHealthSpec {
  readonly tool: string
  readonly action: string
  readonly risk: ToolRisk
  readonly mode: ProbeMode
  /** Static safe arguments for a probe. Fixture-dependent specs omit it. */
  readonly arguments?: Readonly<Record<string, unknown>>
  readonly requiresMemoryFixture?: boolean
  readonly probeReason?: string
}

export interface ToolHealthRecord {
  readonly toolName: string
  readonly action: string
  readonly risk: ToolRisk
  readonly status: ToolHealthStatus
  readonly source: string
  readonly lastCheckedAt: number | null
  readonly lastOkAt: number | null
  readonly latencyMs: number | null
  readonly errorKind: string | null
  readonly errorMessage: string | null
  readonly consecutiveFailures: number
  readonly nextCheckAt: number | null
  readonly details: Record<string, unknown>
}

export interface ToolHealthSummary {
  readonly toolName: string
  readonly risk: ToolRisk
  readonly status: ToolHealthStatus
  readonly source: string
  readonly lastCheckedAt: number | null
  readonly latencyMs: number | null
  readonly errorKind: string | null
  readonly errorMessage: string | null
  readonly dependenciesChecked: false
  readonly actions: readonly ToolHealthRecord[]
}

export interface ProbeResult {
  readonly ok: boolean
  readonly latencyMs: number
  readonly errorKind?: string
  readonly errorMessage?: string
  /** True when the probe could not be run at all (fixture/executor unavailable). */
  readonly notRun?: boolean
  readonly reason?: string
}

import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export interface ProbeRequest {
  readonly tool: string
  readonly action: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
  readonly agent?: ToolRunContext['agent']
  readonly timeoutMs?: number
}

export interface ToolProbeRunner {
  run(request: ProbeRequest): Promise<ProbeResult>
}
