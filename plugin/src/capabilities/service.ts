import type { ResolvedConfig } from '../config.js'
import { FactoryError } from '../core/errors.js'
import { now } from '../core/ids.js'
import type { FactoryDatabase } from '../storage/database.js'
import { CAPABILITY_DEFINITIONS, CAPABILITY_BY_ID } from './definitions.js'
import { detectCapabilities } from './detector.js'
import { CapabilityStore } from './store.js'
import type {
  CapabilityCheckItem,
  CapabilityCheckResult,
  CapabilityRecord,
  CapabilityRequirement,
  CapabilityScanResult,
  CapabilityScope,
  CapabilityStatus,
  CapabilitySummary,
  DetectedCapability,
} from './types.js'

export const CAPABILITY_SCANNER_VERSION = 'capability-v1'

function parseVersion(value: string): number[] | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim())
  if (!match) return null
  return [1, 2, 3, 4].map((index) => Number(match[index] ?? 0))
}

function meetsMinimum(version: string | null, minimum: string | undefined): boolean {
  if (minimum === undefined || minimum.trim() === '') return true
  if (version === null) return false
  const actual = parseVersion(version)
  const required = parseVersion(minimum)
  if (!actual || !required) return false
  for (let index = 0; index < 4; index += 1) {
    if (actual[index]! > required[index]!) return true
    if (actual[index]! < required[index]!) return false
  }
  return true
}

function withStale(records: readonly CapabilityRecord[], at: number): CapabilityRecord[] {
  return records.map((record) => ({ ...record, stale: record.expiresAt !== null && record.expiresAt <= at }))
}

export class CapabilityService {
  private readonly store: CapabilityStore
  private scanning = false

  constructor(
    private readonly db: FactoryDatabase,
    private readonly config: ResolvedConfig,
  ) {
    this.store = new CapabilityStore(db)
  }

  /** Explicit scan only. Never called automatically by check/list/get. */
  async scan(scope: CapabilityScope = 'host'): Promise<CapabilityScanResult> {
    if (scope !== 'host') {
      throw new FactoryError('INVALID_INPUT', 'В BLOCK 4 поддерживается только host scope')
    }
    if (this.scanning) {
      throw new FactoryError('CONFLICT', 'Capability scan уже выполняется')
    }
    this.scanning = true
    const scan = this.store.startScan({ scope, projectId: null, scannerVersion: CAPABILITY_SCANNER_VERSION })
    const startedAt = now()
    try {
      const detected = await detectCapabilities({
        env: process.env,
        platform: process.platform,
        probeMode: this.config.capabilityProbeMode,
        probeTimeoutMs: this.config.capabilityTimeoutMs,
        probeMaxOutputBytes: this.config.capabilityMaxOutputBytes,
      })
      const byId = new Map(detected.map((item) => [item.definition.id, item]))
      const expiresAt = startedAt + this.config.capabilityTtlHours * 60 * 60 * 1000
      const records = CAPABILITY_DEFINITIONS.map((definition) => this.recordFor(definition.id, byId.get(definition.id), expiresAt, startedAt))
      const saved = this.store.replaceRecords(scope, null, records)
      const counts = {
        available: saved.filter((record) => record.status === 'AVAILABLE').length,
        unavailable: saved.filter((record) => record.status === 'UNAVAILABLE').length,
        unknown: saved.filter((record) => record.status === 'UNKNOWN').length,
      }
      return { scan: this.store.finishScan(scan.id, 'COMPLETE', counts, null), capabilities: saved }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.finishScan(scan.id, 'FAILED', {}, message.slice(0, 500))
      throw error
    } finally {
      this.scanning = false
    }
  }

  list(filter: { kind?: string; status?: string } = {}): CapabilityRecord[] {
    const records = withStale(this.store.list({ scope: 'host', projectId: null, kind: filter.kind }), now())
    return filter.status === undefined ? records : records.filter((record) => record.status === filter.status || (filter.status === 'STALE' && record.stale))
  }

  get(id: string): CapabilityRecord | undefined {
    const record = this.store.get(id, 'host', null)
    if (!record) return undefined
    return { ...record, stale: record.expiresAt !== null && record.expiresAt <= now() }
  }

  /**
   * Cache-only readiness check. It never scans and never refreshes. An empty or
   * expired cache is reported as UNKNOWN/STALE so the caller can ask the
   * operator to run an explicit scan/refresh.
   */
  check(requirements: readonly CapabilityRequirement[]): CapabilityCheckResult {
    const at = now()
    const items: CapabilityCheckItem[] = requirements.map((requirement) => {
      const record = this.store.get(requirement.id, 'host', null)
      if (!record) {
        return {
          id: requirement.id,
          status: 'UNKNOWN',
          ready: false,
          version: null,
          minVersion: requirement.minVersion ?? null,
          reason: 'cache_empty',
        }
      }
      if (record.stale) {
        return {
          id: requirement.id,
          status: 'STALE',
          ready: false,
          version: record.version,
          minVersion: requirement.minVersion ?? null,
          reason: 'cache_stale',
        }
      }
      if (record.status !== 'AVAILABLE') {
        return {
          id: requirement.id,
          status: record.status,
          ready: false,
          version: record.version,
          minVersion: requirement.minVersion ?? null,
          reason: record.status === 'UNAVAILABLE' ? 'not_installed' : 'not_available',
        }
      }
      if (!meetsMinimum(record.version, requirement.minVersion)) {
        return {
          id: requirement.id,
          status: 'UNKNOWN',
          ready: false,
          version: record.version,
          minVersion: requirement.minVersion ?? null,
          reason: record.version === null ? 'version_unknown' : 'version_below_minimum',
        }
      }
      return {
        id: requirement.id,
        status: 'AVAILABLE',
        ready: true,
        version: record.version,
        minVersion: requirement.minVersion ?? null,
        reason: 'available',
      }
    })
    return {
      ready: items.every((item) => item.ready),
      checkedAt: at,
      items,
    }
  }

  summary(): CapabilitySummary {
    const at = now()
    const records = withStale(this.store.list({ scope: 'host', projectId: null }), at)
    const scan = this.store.latestScan('host', null)
    const byId = new Map(records.map((record) => [record.capabilityId, record]))
    const capabilities = CAPABILITY_DEFINITIONS.map((definition) => {
      const record = byId.get(definition.id)
      const status: CapabilityStatus = record === undefined ? 'UNKNOWN' : record.stale ? 'STALE' : record.status
      return { id: definition.id, status, version: record?.version ?? null, stale: record?.stale ?? false }
    })
    return {
      checkedAt: at,
      scanId: scan?.id ?? null,
      available: capabilities.filter((item) => item.status === 'AVAILABLE').length,
      unavailable: capabilities.filter((item) => item.status === 'UNAVAILABLE').length,
      stale: capabilities.filter((item) => item.status === 'STALE').length,
      unknown: capabilities.filter((item) => item.status === 'UNKNOWN').length,
      capabilities,
    }
  }

  definition(id: string) {
    return CAPABILITY_BY_ID.get(id)
  }

  private recordFor(
    id: string,
    detected: DetectedCapability | undefined,
    expiresAt: number,
    timestamp: number,
  ): Omit<CapabilityRecord, 'id' | 'stale'> {
    const definition = CAPABILITY_BY_ID.get(id)!
    return {
      scope: 'host',
      projectId: null,
      capabilityId: id,
      kind: definition.kind,
      path: detected?.path ?? null,
      version: detected?.version ?? null,
      versionSource: detected?.versionSource ?? 'none',
      status: detected ? 'AVAILABLE' : 'UNAVAILABLE',
      confidence: detected ? 1 : 0,
      details: detected ? { ...detected.details } : {},
      lastSeenAt: timestamp,
      expiresAt,
      updatedAt: timestamp,
    }
  }
}
