import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolHealthService } from '../src/health/service.js'
import { TOOL_HEALTH_SPECS } from '../src/health/registry.js'
import type { ProbeRequest, ProbeResult, ToolProbeRunner } from '../src/health/types.js'
import { createTestRuntime, track } from './helpers.js'

function fakeContext(): Context {
  const names = [...new Set(TOOL_HEALTH_SPECS.map((spec) => spec.tool))]
  const definitions = names.map((name) => ({ name, description: name }))
  return {
    tools: {
      definitions: () => definitions,
    },
  } as unknown as Context
}

function fakeExec(): ToolRunContext {
  return {
    callId: 'call_health',
    name: 'factory_tool_health_check',
    arguments: {},
    signal: new AbortController().signal,
    agent: { id: 'ses_root' },
  } as unknown as ToolRunContext
}

function probeFrom(handler: (request: ProbeRequest) => ProbeResult): ToolProbeRunner {
  return { run: async (request) => handler(request) }
}

function serviceWith(runtime: ReturnType<typeof createTestRuntime>, probe: ToolProbeRunner): ToolHealthService {
  return new ToolHealthService(fakeContext(), runtime, probe)
}

describe('ToolHealthService', () => {
  it('does not include the health tools themselves in the risk registry', () => {
    expect(TOOL_HEALTH_SPECS.some((spec) => spec.tool.startsWith('factory_tool_health'))).toBe(false)
  })

  it('maps R1 to REGISTERED and R2 to NOT_TESTABLE without executing them', async () => {
    const { runtime } = track(createTestRuntime())
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const service = serviceWith(runtime, { run: probe })

    const r1 = await service.check({ tool: 'factory_memory_remember', force: true }, fakeExec())
    const r2 = await service.check({ tool: 'factory_dispatch', force: true }, fakeExec())

    expect(r1[0]?.status).toBe('REGISTERED')
    expect(r1[0]?.source).toBe('schema')
    expect(r1[0]?.details.dependenciesChecked).toBe(false)
    expect(r2[0]?.status).toBe('NOT_TESTABLE')
    expect(probe).not.toHaveBeenCalled()
  })

  it('marks observed R0 as UNKNOWN with a hidden-side-effect reason', async () => {
    const { runtime } = track(createTestRuntime())
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const service = serviceWith(runtime, { run: probe })

    const results = await service.check({ tool: 'factory_memory_search', force: true }, fakeExec())

    expect(results[0]?.status).toBe('UNKNOWN')
    expect(results[0]?.source).toBe('observed')
    expect(results[0]?.details.reason).toContain('audit_log')
    expect(probe).not.toHaveBeenCalled()
  })

  it('runs pure R0 probes and supports circuit cooldown', async () => {
    const { runtime } = track(createTestRuntime())
    const probe = vi.fn(async (request: ProbeRequest): Promise<ProbeResult> => {
      if (request.tool === 'factory_status') {
        return { ok: false, latencyMs: 2, errorKind: 'FS_ERROR', errorMessage: 'broken' }
      }
      return { ok: true, latencyMs: 1 }
    })
    const service = serviceWith(runtime, { run: probe })

    for (let index = 0; index < 3; index += 1) {
      const result = await service.check({ tool: 'factory_status', force: true }, fakeExec())
      expect(result[0]?.status).toBe('UNAVAILABLE')
    }
    expect(probe).toHaveBeenCalledTimes(3)
    const row = runtime.db.get<{ next_check_at: number | null; consecutive_failures: number }>(
      "SELECT next_check_at, consecutive_failures FROM tool_health WHERE tool_name = 'factory_status'",
    )
    expect(row?.consecutive_failures).toBe(3)
    expect(row?.next_check_at).toBeGreaterThan(Date.now())

    const cached = await service.check({ tool: 'factory_status', force: true }, fakeExec())
    expect(cached[0]?.status).toBe('UNAVAILABLE')
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('honours the 10-minute TTL unless force is set', async () => {
    const { runtime } = track(createTestRuntime())
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const service = serviceWith(runtime, { run: probe })

    await service.check({ tool: 'factory_status' }, fakeExec())
    await service.check({ tool: 'factory_status' }, fakeExec())
    expect(probe).toHaveBeenCalledTimes(1)

    await service.check({ tool: 'factory_status', force: true }, fakeExec())
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('keeps mixed tools when only R0 status is unavailable', async () => {
    const { runtime } = track(createTestRuntime())
    const probe = vi.fn(async (request: ProbeRequest): Promise<ProbeResult> =>
      request.tool === 'factory_sync'
        ? { ok: false, latencyMs: 2, errorKind: 'HTTP_500', errorMessage: 'down' }
        : { ok: true, latencyMs: 1 },
    )
    const service = serviceWith(runtime, { run: probe })
    await service.check({ tool: 'factory_sync', force: true }, fakeExec())

    const summary = service.summaries({ tool: 'factory_sync' })[0]!
    expect(summary.status).toBe('DEGRADED')
    expect(service.effectiveAllowedTools(['factory_sync', 'read'])).toEqual(['factory_sync', 'read'])
  })

  it('removes a tool only when all actions are unavailable', async () => {
    const { runtime } = track(createTestRuntime())
    const ctx = fakeContext()
    const service = new ToolHealthService(ctx, runtime, { run: async () => ({ ok: true, latencyMs: 1 }) })
    const definitions = (ctx.tools as unknown as { definitions: () => Array<{ name: string; description: string }> }).definitions
    const original = definitions()
    ;(ctx.tools as unknown as { definitions: () => unknown }).definitions = () =>
      original.filter((entry) => entry.name !== 'factory_memory_search')
    await service.check({ tool: 'factory_memory_search', force: true }, fakeExec())

    const summary = service.summaries({ tool: 'factory_memory_search' })[0]!
    expect(summary.status).toBe('UNAVAILABLE')
    expect(service.effectiveAllowedTools(['factory_memory_search', 'read'])).toEqual(['read'])
  })

  it('passes host tools through without a health record', async () => {
    const { runtime } = track(createTestRuntime())
    const service = serviceWith(runtime, { run: async () => ({ ok: true, latencyMs: 1 }) })
    expect(service.effectiveAllowedTools(['read', 'write', 'factory_status', 'browser_open'])).toEqual([
      'read', 'write', 'factory_status', 'browser_open',
    ])
    expect(service.list({ tool: 'read' })).toEqual([])
  })
})
