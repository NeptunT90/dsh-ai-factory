import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { FactoryError, errorMessage } from '../core/errors.js'
import { newId, now } from '../core/ids.js'
import type { FactoryRuntime } from '../runtime.js'
import { DshProbeRunner } from './probe.js'
import { HEALTH_TOOL_NAMES, TOOL_HEALTH_SPECS, specsFor } from './registry.js'
import {
  TOOL_HEALTH_STATUSES,
  type ProbeResult,
  type ToolHealthRecord,
  type ToolHealthSpec,
  type ToolHealthStatus,
  type ToolHealthSummary,
  type ToolProbeRunner,
  type ToolRisk,
} from './types.js'

const TTL_MS = 600_000
const COOLDOWN_MS = 300_000
const FAILURE_THRESHOLD = 3
const DEGRADED_LATENCY_MS = 2_000

interface HealthRow {
  tool_name: string
  action: string
  risk: ToolRisk
  status: ToolHealthStatus
  source: string
  last_checked_at: number | null
  last_ok_at: number | null
  latency_ms: number | null
  error_kind: string | null
  error_message: string | null
  consecutive_failures: number
  next_check_at: number | null
  details: string
}

interface HistoryRow {
  id: string
  tool_name: string
  action: string
  status: ToolHealthStatus
  checked_at: number
  latency_ms: number | null
  error_kind: string | null
  error_message: string | null
  details: string
}

export interface CheckOptions {
  readonly tool?: string
  readonly action?: string
  readonly force?: boolean
}

export interface HealthListOptions {
  readonly tool?: string
  readonly action?: string
  readonly status?: ToolHealthStatus
}

function isHealthStatus(value: unknown): value is ToolHealthStatus {
  return typeof value === 'string' && (TOOL_HEALTH_STATUSES as readonly string[]).includes(value)
}

function parseDetails(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return {}
}

function rowRecord(row: HealthRow): ToolHealthRecord {
  return {
    toolName: row.tool_name,
    action: row.action,
    risk: row.risk,
    status: row.status,
    source: row.source,
    lastCheckedAt: row.last_checked_at,
    lastOkAt: row.last_ok_at,
    latencyMs: row.latency_ms,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
    consecutiveFailures: row.consecutive_failures,
    nextCheckAt: row.next_check_at,
    details: parseDetails(row.details),
  }
}

function syntheticRecord(spec: ToolHealthSpec): ToolHealthRecord {
  return {
    toolName: spec.tool,
    action: spec.action,
    risk: spec.risk,
    status: 'UNKNOWN',
    source: 'none',
    lastCheckedAt: null,
    lastOkAt: null,
    latencyMs: null,
    errorKind: null,
    errorMessage: null,
    consecutiveFailures: 0,
    nextCheckAt: null,
    details: spec.mode === 'observed' ? { reason: spec.probeReason ?? 'hidden_side_effect' } : {},
  }
}

/**
 * Tool health overlay for factory_* tools only. Host tools are intentionally
 * out of scope and are never written to tool_health or filtered.
 */
export class ToolHealthService {
  private readonly probe: ToolProbeRunner

  constructor(
    private readonly ctx: Context,
    private readonly runtime: FactoryRuntime,
    probe?: ToolProbeRunner,
  ) {
    this.probe = probe ?? new DshProbeRunner(ctx)
  }

  list(options: HealthListOptions = {}): ToolHealthRecord[] {
    const rows = new Map(
      this.allRows().map((row) => [`${row.tool_name}\u0000${row.action}`, rowRecord(row)]),
    )
    return specsFor(options.tool, options.action)
      .filter((spec) => options.status === undefined || (rows.get(`${spec.tool}\u0000${spec.action}`)?.status ?? 'UNKNOWN') === options.status)
      .map((spec) => rows.get(`${spec.tool}\u0000${spec.action}`) ?? syntheticRecord(spec))
  }

  summaries(options: HealthListOptions = {}): ToolHealthSummary[] {
    const records = this.list(options)
    const byTool = new Map<string, ToolHealthRecord[]>()
    for (const record of records) {
      const list = byTool.get(record.toolName) ?? []
      list.push(record)
      byTool.set(record.toolName, list)
    }
    const result: ToolHealthSummary[] = []
    for (const [toolName, actions] of byTool) {
      const record = this.aggregate(toolName, actions)
      result.push({
        toolName,
        risk: record.risk,
        status: record.status,
        source: record.source,
        lastCheckedAt: record.lastCheckedAt,
        latencyMs: record.latencyMs,
        errorKind: record.errorKind,
        errorMessage: record.errorMessage,
        dependenciesChecked: false,
        actions,
      })
    }
    return result
  }

  async check(options: CheckOptions, exec: ToolRunContext): Promise<ToolHealthRecord[]> {
    this.assertRoot(exec)
    const specs = specsFor(options.tool, options.action)
    if (specs.length === 0) {
      throw new FactoryError('INVALID_INPUT', `Неизвестный factory-инструмент/действие: ${options.tool ?? '*'}${options.action ? `/${options.action}` : ''}`)
    }
    const registered = new Set(this.ctx.tools.definitions().map((definition) => definition.name))
    const results: ToolHealthRecord[] = []
    for (const spec of specs) {
      if (!registered.has(spec.tool)) {
        results.push(this.persist(spec, {
          status: 'UNAVAILABLE',
          source: 'auto',
          latencyMs: null,
          errorKind: 'NOT_REGISTERED',
          errorMessage: 'tool is not present in the current DSH registry',
          details: { registered: false, dependenciesChecked: false },
        }))
        continue
      }
      const existing = this.row(spec.tool, spec.action)
      if (!options.force && existing && existing.last_checked_at !== null
        && now() - existing.last_checked_at < TTL_MS) {
        results.push(rowRecord(existing))
        continue
      }
      results.push(await this.checkOne(spec, exec, existing))
    }
    return results
  }

  history(tool?: string, action?: string, limit = 100): Array<Record<string, unknown>> {
    const capped = Math.max(1, Math.min(200, Math.floor(limit)))
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (tool !== undefined) {
      clauses.push('tool_name = ?')
      params.push(tool)
    }
    if (action !== undefined) {
      clauses.push('action = ?')
      params.push(action)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.runtime.db.all<HistoryRow>(
      `SELECT id, tool_name, action, status, checked_at, latency_ms, error_kind, error_message, details
       FROM tool_health_history ${where} ORDER BY checked_at DESC LIMIT ?`,
      [...params, capped],
    )
    return rows.map((row) => ({
      id: row.id,
      tool: row.tool_name,
      action: row.action,
      status: row.status,
      checkedAt: row.checked_at,
      latencyMs: row.latency_ms,
      errorKind: row.error_kind,
      errorMessage: row.error_message,
      details: parseDetails(row.details),
    }))
  }

  effectiveAllowedTools(allowed: readonly string[]): string[] {
    return allowed.filter((name) => {
      if (!name.startsWith('factory_')) return true
      if (HEALTH_TOOL_NAMES.includes(name as (typeof HEALTH_TOOL_NAMES)[number])) return true
      const summary = this.summaryFor(name)
      return summary === undefined || (summary !== 'UNAVAILABLE' && summary !== 'DISABLED')
    })
  }

  private async checkOne(
    spec: ToolHealthSpec,
    exec: ToolRunContext,
    existing: HealthRow | undefined,
  ): Promise<ToolHealthRecord> {
    if (spec.mode === 'schema') {
      return this.persist(spec, {
        status: 'REGISTERED',
        source: 'schema',
        latencyMs: null,
        details: { registered: true, dependenciesChecked: false, dependenciesScope: 'BLOCK_4' },
      })
    }
    if (spec.mode === 'not_testable') {
      return this.persist(spec, {
        status: 'NOT_TESTABLE',
        source: 'schema',
        latencyMs: null,
        details: { registered: true, dependenciesChecked: false, dependenciesScope: 'BLOCK_4', reason: 'dangerous_action' },
      })
    }
    if (spec.mode === 'observed') {
      return this.persist(spec, {
        status: 'UNKNOWN',
        source: 'observed',
        latencyMs: null,
        details: {
          registered: true,
          dependenciesChecked: false,
          reason: spec.probeReason ?? 'hidden_side_effect',
          realProbe: 'TODO:BLOCK_1',
        },
      })
    }
    if (existing?.next_check_at !== null && existing?.next_check_at !== undefined && existing.next_check_at > now()) {
      return rowRecord(existing)
    }
    const args = this.probeArguments(spec)
    if (args === undefined) {
      return this.persist(spec, {
        status: 'UNKNOWN',
        source: 'auto',
        latencyMs: null,
        details: { registered: true, dependenciesChecked: false, reason: 'no_safe_fixture' },
      })
    }
    let result: ProbeResult
    try {
      result = await this.probe.run({
        tool: spec.tool,
        action: spec.action,
        arguments: args,
        signal: exec.signal,
        agent: exec.agent,
      })
    } catch (error) {
      result = {
        ok: false,
        latencyMs: 0,
        errorKind: 'PROBE_EXCEPTION',
        errorMessage: errorMessage(error).slice(0, 500),
      }
    }
    if (result.notRun) {
      return this.persist(spec, {
        status: 'UNKNOWN',
        source: 'auto',
        latencyMs: result.latencyMs,
        errorKind: result.errorKind ?? 'PIPELINE_UNAVAILABLE',
        errorMessage: result.errorMessage ?? result.reason ?? 'probe did not run',
        details: { registered: true, dependenciesChecked: false, reason: result.reason ?? 'pipeline_unavailable' },
      })
    }
    if (result.ok) {
      const degraded = result.latencyMs >= DEGRADED_LATENCY_MS
      return this.persist(spec, {
        status: degraded ? 'DEGRADED' : 'HEALTHY',
        source: 'auto',
        latencyMs: result.latencyMs,
        details: { registered: true, dependenciesChecked: false, latencyThresholdMs: DEGRADED_LATENCY_MS },
      })
    }
    const errorKind = result.errorKind ?? 'PROBE_ERROR'
    const invalid = ['INVALID_INPUT', 'NOT_FOUND', 'UNKNOWN_TOOL', 'TOOL_ARGS_INVALID'].includes(errorKind)
    if (invalid) {
      return this.persist(spec, {
        status: 'UNKNOWN',
        source: 'auto',
        latencyMs: result.latencyMs,
        errorKind,
        errorMessage: result.errorMessage ?? '',
        details: { registered: true, dependenciesChecked: false, reason: 'probe_argument_error' },
      })
    }
    const failures = (existing?.consecutive_failures ?? 0) + 1
    const nextCheckAt = failures >= FAILURE_THRESHOLD ? now() + COOLDOWN_MS : null
    return this.persist(spec, {
      status: 'UNAVAILABLE',
      source: 'auto',
      latencyMs: result.latencyMs,
      errorKind,
      errorMessage: result.errorMessage ?? '',
      consecutiveFailures: failures,
      nextCheckAt,
      details: {
        registered: true,
        dependenciesChecked: false,
        circuitOpen: nextCheckAt !== null,
        cooldownMs: COOLDOWN_MS,
      },
    })
  }

  private probeArguments(spec: ToolHealthSpec): Record<string, unknown> | undefined {
    if (spec.arguments !== undefined) return { ...spec.arguments }
    if (!spec.requiresMemoryFixture) return undefined
    try {
      const hit = this.runtime.memory.search({ limit: 1 })[0]
      return hit === undefined ? undefined : { id: hit.id }
    } catch {
      return undefined
    }
  }

  private assertRoot(exec: ToolRunContext): void {
    if (!exec.agent) throw new FactoryError('FORBIDDEN', 'tool health requires a calling agent')
    if (this.runtime.hasChildAllowlist(exec.agent.id)) {
      throw new FactoryError('FORBIDDEN', 'tool health is root-only; child allowlists cannot run it')
    }
  }

  private persist(
    spec: ToolHealthSpec,
    input: {
      status: ToolHealthStatus
      source: string
      latencyMs: number | null
      errorKind?: string
      errorMessage?: string
      consecutiveFailures?: number
      nextCheckAt?: number | null
      details: Record<string, unknown>
    },
  ): ToolHealthRecord {
    const ts = now()
    const failures = input.consecutiveFailures ?? 0
    const details = JSON.stringify(input.details)
    this.runtime.db.run(
      `INSERT INTO tool_health
        (tool_name, action, risk, status, source, last_checked_at, last_ok_at, latency_ms,
         error_kind, error_message, consecutive_failures, next_check_at, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tool_name, action) DO UPDATE SET
         risk = excluded.risk, status = excluded.status, source = excluded.source,
         last_checked_at = excluded.last_checked_at,
         last_ok_at = CASE WHEN excluded.status = 'HEALTHY' THEN excluded.last_checked_at ELSE tool_health.last_ok_at END,
         latency_ms = excluded.latency_ms, error_kind = excluded.error_kind,
         error_message = excluded.error_message, consecutive_failures = excluded.consecutive_failures,
         next_check_at = excluded.next_check_at, details = excluded.details`,
      [
        spec.tool, spec.action, spec.risk, input.status, input.source, ts,
        input.status === 'HEALTHY' ? ts : null,
        input.latencyMs, input.errorKind ?? null, input.errorMessage ?? null,
        failures, input.nextCheckAt ?? null, details,
      ],
    )
    this.runtime.db.run(
      `INSERT INTO tool_health_history
        (id, tool_name, action, status, checked_at, latency_ms, error_kind, error_message, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('hlt'), spec.tool, spec.action, input.status, ts, input.latencyMs,
        input.errorKind ?? null, input.errorMessage ?? null, details],
    )
    return rowRecord(this.row(spec.tool, spec.action) as HealthRow)
  }

  private row(tool: string, action: string): HealthRow | undefined {
    return this.runtime.db.get<HealthRow>(
      'SELECT * FROM tool_health WHERE tool_name = ? AND action = ?',
      [tool, action],
    )
  }

  private allRows(): HealthRow[] {
    return this.runtime.db.all<HealthRow>('SELECT * FROM tool_health')
  }

  private summaryFor(tool: string): ToolHealthStatus | undefined {
    const rows = this.allRows().filter((row) => row.tool_name === tool)
    if (rows.length === 0) return undefined
    return this.aggregate(tool, rows.map(rowRecord)).status
  }

  private aggregate(tool: string, actions: readonly ToolHealthRecord[]): ToolHealthRecord {
    const specs = specsFor(tool)
    const spec = specs[0]
    if (!spec) {
      return {
        toolName: tool, action: '*', risk: 'R0', status: 'UNAVAILABLE', source: 'none',
        lastCheckedAt: null, lastOkAt: null, latencyMs: null, errorKind: null,
        errorMessage: null, consecutiveFailures: 0, nextCheckAt: null,
        details: { reason: 'not_in_registry' },
      }
    }
    const allUnavailable = actions.length > 0 && actions.every((action) => action.status === 'UNAVAILABLE' || action.status === 'DISABLED')
    const anyR0Unavailable = actions.some((action) => action.risk === 'R0' && (action.status === 'UNAVAILABLE' || action.status === 'DISABLED'))
    const allR0Healthy = actions.filter((action) => action.risk === 'R0').every((action) => action.status === 'HEALTHY' || action.status === 'DEGRADED')
    let status: ToolHealthStatus
    if (allUnavailable) status = 'UNAVAILABLE'
    else if (anyR0Unavailable) status = 'DEGRADED'
    else if (actions.some((action) => action.risk === 'R0')) status = allR0Healthy ? 'HEALTHY' : 'UNKNOWN'
    else if (actions.some((action) => action.risk === 'R1')) status = 'REGISTERED'
    else status = 'NOT_TESTABLE'
    const primary = actions.find((action) => action.risk === 'R0') ?? actions[0] ?? syntheticRecord(spec)
    return {
      toolName: tool,
      action: primary.action,
      risk: spec.risk,
      status,
      source: primary.source,
      lastCheckedAt: Math.max(...actions.map((action) => action.lastCheckedAt ?? 0), 0) || null,
      lastOkAt: primary.lastOkAt,
      latencyMs: primary.latencyMs,
      errorKind: primary.errorKind,
      errorMessage: primary.errorMessage,
      consecutiveFailures: Math.max(...actions.map((action) => action.consecutiveFailures), 0),
      nextCheckAt: primary.nextCheckAt,
      details: {
        allActionsUnavailable: allUnavailable,
        anyR0Unavailable,
        dependenciesChecked: false,
        actions: actions.map((action) => ({ action: action.action, status: action.status })),
      },
    }
  }
}
