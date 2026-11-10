import type { CapabilityProbeMode } from '../config.js'

export const CAPABILITY_KINDS = [
  'runtime',
  'sdk',
  'container',
  'vcs',
  'package_manager',
  'build',
  'tool',
] as const
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number]

export const CAPABILITY_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'STALE', 'UNKNOWN', 'DISABLED'] as const
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number]

export const CAPABILITY_VERSION_SOURCES = ['file', 'probe', 'none', 'unknown'] as const
export type CapabilityVersionSource = (typeof CAPABILITY_VERSION_SOURCES)[number]

export type CapabilityScope = 'host' | 'project'

export interface CapabilityDefinition {
  readonly id: string
  readonly name: string
  readonly kind: CapabilityKind
  /** Base executable names; platform extensions are added by the detector. */
  readonly binaries: readonly string[]
  /** Fixed argv used only when capabilityProbeMode=safe. Never user input. */
  readonly probeArgs?: readonly string[]
}

export interface CapabilityRecord {
  readonly id: string
  readonly scope: CapabilityScope
  readonly projectId: string | null
  readonly capabilityId: string
  readonly kind: CapabilityKind
  readonly path: string | null
  readonly version: string | null
  readonly versionSource: CapabilityVersionSource
  readonly status: CapabilityStatus
  readonly confidence: number
  readonly details: Readonly<Record<string, unknown>>
  readonly lastSeenAt: number
  readonly expiresAt: number | null
  readonly updatedAt: number
  /** Computed at read time; never persisted as true. */
  readonly stale: boolean
}

export interface CapabilityScanRecord {
  readonly id: string
  readonly scope: CapabilityScope
  readonly projectId: string | null
  readonly status: 'RUNNING' | 'COMPLETE' | 'FAILED'
  readonly scannerVersion: string
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly counts: Readonly<Record<string, number>>
  readonly error: string | null
}

export interface CapabilityScanResult {
  readonly scan: CapabilityScanRecord
  readonly capabilities: readonly CapabilityRecord[]
}

export interface CapabilityRequirement {
  readonly id: string
  readonly minVersion?: string
}

export interface CapabilityCheckItem {
  readonly id: string
  readonly status: CapabilityStatus | 'UNKNOWN'
  readonly ready: boolean
  readonly version: string | null
  readonly minVersion: string | null
  readonly reason: string
}

export interface CapabilityCheckResult {
  readonly ready: boolean
  readonly checkedAt: number
  readonly items: readonly CapabilityCheckItem[]
}

export interface CapabilitySummary {
  readonly checkedAt: number
  readonly scanId: string | null
  readonly available: number
  readonly unavailable: number
  readonly stale: number
  readonly unknown: number
  readonly capabilities: ReadonlyArray<{
    readonly id: string
    readonly status: CapabilityStatus
    readonly version: string | null
    readonly stale: boolean
  }>
}

export interface DetectOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly pathDirs?: readonly string[]
  readonly probeMode?: CapabilityProbeMode
  readonly probeTimeoutMs?: number
  readonly probeMaxOutputBytes?: number
}

export interface DetectedCapability {
  readonly definition: CapabilityDefinition
  readonly path: string
  readonly version: string | null
  readonly versionSource: CapabilityVersionSource
  readonly details: Readonly<Record<string, unknown>>
}
