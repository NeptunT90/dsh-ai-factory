import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { detectCapabilities } from '../src/capabilities/detector.js'
import { CAPABILITY_DEFINITIONS } from '../src/capabilities/definitions.js'
import { registerCapabilityTools } from '../src/capabilities/tools.js'
import { registerTaskTools } from '../src/tasks/tools.js'
import { DispatchService } from '../src/dispatch/service.js'
import { TOOL_HEALTH_SPECS } from '../src/health/registry.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_capability',
    name: 'factory_capability_check',
    arguments: {},
    signal: new AbortController().signal,
    agent: { id: agentId, session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

function captureTools(register: (ctx: Context) => unknown): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      definitions: () => [],
    },
  } as unknown as Context
  register(ctx)
  return tools
}

function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code })
}

function expectSyncCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`expected ${code}`)
}

describe('capability discovery', () => {
  it('detects a binary from an allowlisted path without executing it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-factory-cap-'))
    try {
      const bin = join(root, 'bin')
      mkdirSync(bin)
      const name = process.platform === 'win32' ? 'node.exe' : 'node'
      const path = join(bin, name)
      writeFileSync(path, 'not executed')
      if (process.platform !== 'win32') chmodSync(path, 0o755)

      const found = await detectCapabilities({
        pathDirs: [bin],
        env: {},
        platform: process.platform,
        probeMode: 'off',
      })
      const node = found.find((item) => item.definition.id === 'node')
      expect(node?.path).toBe(path)
      expect(node?.version).toBeNull()
      expect(node?.versionSource).toBe('none')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps Docker presence-only with no probe arguments', () => {
    expect(CAPABILITY_DEFINITIONS.find((definition) => definition.id === 'docker')?.probeArgs).toBeUndefined()
  })

  it('does not auto-scan from check and reports UNKNOWN/STALE from cache only', () => {
    const { runtime, projectId } = track(createTestRuntime())
    expect(runtime.capabilities.check([{ id: 'node' }]).items[0]?.status).toBe('UNKNOWN')
    expect(runtime.db.get<{ n: number }>('SELECT count(*) AS n FROM capability_scans')?.n).toBe(0)
    expect(runtime.capabilities.list()).toEqual([])

    void projectId
  })

  it('explicit scan fills the cache and TTL produces STALE', async () => {
    const { runtime } = track(createTestRuntime())
    const result = await runtime.capabilities.scan('host')
    expect(result.scan.status).toBe('COMPLETE')
    expect(result.capabilities).toHaveLength(14)
    expect(runtime.capabilities.list().length).toBeGreaterThan(0)
    expect(runtime.db.get<{ n: number }>('SELECT count(*) AS n FROM capability_scans')?.n).toBe(1)

    const node = runtime.capabilities.get('node')
    if (node) {
      runtime.db.run('UPDATE capabilities SET expires_at = ? WHERE capability_id = ?', [Date.now() - 1, 'node'])
      const check = runtime.capabilities.check([{ id: 'node' }])
      expect(check.items[0]?.status).toBe('STALE')
      expect(check.ready).toBe(false)
    }
  })

  it('exposes root-only capability tools and never auto-scans from check', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const tools = captureTools((ctx) => registerCapabilityTools(ctx, () => runtime, () => undefined))
    const root = fakeExec('ses_root', runtime.projects.require(projectId).rootPath)
    const check = (await tools.get('factory_capability_check')!.execute(
      { requirements: [{ id: 'node' }] },
      root,
    )) as { ready: boolean; items: Array<{ status: string }> }
    expect(check.ready).toBe(false)
    expect(check.items[0]?.status).toBe('UNKNOWN')
    expect(runtime.db.get<{ n: number }>('SELECT count(*) AS n FROM capability_scans')?.n).toBe(0)

    const list = (await tools.get('factory_capability_list')!.execute({}, root)) as { count: number }
    expect(list.count).toBe(0)

    const scan = (await tools.get('factory_capability_scan')!.execute({}, root)) as { status: string }
    expect(scan.status).toBe('COMPLETE')
    const after = (await tools.get('factory_capability_list')!.execute({}, root)) as { count: number }
    expect(after.count).toBe(14)

    runtime.allowToolsForChild('ses_child', ['factory_capability_list'])
    await expectCode(
      tools.get('factory_capability_list')!.execute({}, fakeExec('ses_child', runtime.projects.require(projectId).rootPath)),
      'FORBIDDEN',
    )
  })

  it('blocks planning, task creation, and dispatch when capabilities are missing', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const planner = runtime.planner
    expectSyncCode(
      () => planner.createPlan({ projectId, goal: 'Need a missing runtime', steps: [{ key: 'a', title: 'A', requiresCapabilities: ['definitely-missing'] }] }),
      'CAPABILITY_MISSING',
    )
    expect(runtime.tasks.count()).toBe(0)

    const taskTools = captureTools((ctx) => registerTaskTools(ctx, () => runtime, () => undefined))
    await expectCode(
      taskTools.get('factory_task_create')!.execute(
        { title: 'Missing capability task', requiresCapabilities: ['definitely-missing'] },
        fakeExec('ses_root', project.rootPath),
      ),
      'CAPABILITY_MISSING',
    )
    expect(runtime.tasks.count()).toBe(0)

    const task = runtime.tasks.create({ projectId, title: 'Dispatch missing capability', metadata: { requiresCapabilities: ['definitely-missing'] } })
    let childStarted = false
    const service = new DispatchService({} as Context, runtime, {
      async run() {
        childStarted = true
        return { childId: 'ses_child', output: 'unexpected', stopReason: 'completed', diagnostic: '' }
      },
    })
    await expectCode(
      service.dispatch({ taskId: task.id }, fakeExec('ses_root', project.rootPath)),
      'CAPABILITY_MISSING',
    )
    expect(childStarted).toBe(false)
    expect(runtime.tasks.require(task.id).status).toBe('READY')
  })

  it('has 51 factory capability-aware tools / 59 health actions', () => {
    expect(new Set(TOOL_HEALTH_SPECS.map((spec) => spec.tool)).size).toBe(51)
    expect(TOOL_HEALTH_SPECS).toHaveLength(59)
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_capability_list')?.mode).toBe('probe')
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_capability_get')?.mode).toBe('observed')
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_capability_scan')?.risk).toBe('R1')
  })

  it('creates capability tables through schema v7', () => {
    const { runtime } = track(createTestRuntime())
    const names = runtime.db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => row.name)
    expect(names).toEqual(expect.arrayContaining(['capability_scans', 'capabilities']))
    expect(runtime.db.schemaVersion).toBe(7)
    void mkdirSync
  })
})
