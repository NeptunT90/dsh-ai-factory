import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'
import { testConfig } from './helpers.js'

interface Harness {
  readonly tools: Map<string, ToolDefinition>
  readonly workspace: string
  readonly dir: string
  dispose(): Promise<void>
}

const harnesses: Harness[] = []

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    try {
      await harness.dispose()
    } finally {
      rmSync(harness.dir, { recursive: true, force: true })
    }
  }
})

function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'ai-factory-plugin-'))
  const workspace = join(dir, 'workspace')
  const tools = new Map<string, ToolDefinition>()
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  }
  let lifecycle: (() => void | Promise<void>) | undefined
  const ctx = {
    logger: Object.assign((_name?: string) => logger, logger),
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      guard() {
        return () => {}
      },
    },
    effect(execute: () => () => void | Promise<void>) {
      lifecycle = execute()
      return async () => {}
    },
  } as unknown as Context

  apply(ctx, { ...testConfig(dir), dataDir: dir })
  const harness: Harness = {
    tools,
    workspace,
    dir,
    async dispose() {
      await lifecycle?.()
    },
  }
  harnesses.push(harness)
  return harness
}

function fakeExec(workspace: string): unknown {
  return {
    callId: 'call_test',
    name: 'factory_test',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      id: 'ses_test',
      session: { header: { cwd: workspace } },
    },
  }
}

describe('plugin mount', () => {
  it('registers host tools and reports a working SQLite driver', async () => {
    const harness = createHarness()
    expect(harness.tools.has('factory_status')).toBe(true)
    expect(harness.tools.has('factory_memory_remember')).toBe(true)
    expect(harness.tools.has('factory_memory_search')).toBe(true)
    expect(harness.tools.size).toBe(56)
    expect(harness.tools.has('factory_agent_list')).toBe(true)
    expect(harness.tools.has('factory_task_create')).toBe(true)
    expect(harness.tools.has('factory_plan_create')).toBe(true)
    expect(harness.tools.has('factory_dispatch')).toBe(true)
    expect(harness.tools.has('factory_dashboard')).toBe(true)
    expect(harness.tools.has('factory_sync')).toBe(true)
    expect(harness.tools.has('factory_review')).toBe(true)
    expect(harness.tools.has('factory_workflow_run')).toBe(true)
    expect(harness.tools.has('factory_model_route')).toBe(true)
    expect(harness.tools.has('factory_auto_workflow')).toBe(true)
    expect(harness.tools.has('factory_skill_list')).toBe(true)
    expect(harness.tools.has('factory_skill_assign')).toBe(true)

    const status = await harness.tools.get('factory_status')!.execute({}, fakeExec(harness.workspace) as never)
    expect((status as { status: string }).status).toBe('ready')
    expect((status as { driver: string }).driver).toBe('node:sqlite')
  })

  it('stores and retrieves memory through the model-facing tool contract', async () => {
    const harness = createHarness()
    const exec = fakeExec(harness.workspace) as never
    const remember = harness.tools.get('factory_memory_remember')!
    const stored = (await remember.execute(
      {
        content: 'Инструмент AI Factory реально вызывает SQLite.',
        title: 'Проверка инструмента',
        kind: 'project',
        tags: ['plugin', 'sqlite'],
      },
      exec,
    )) as { entry: { id: string } }

    const search = harness.tools.get('factory_memory_search')!
    const found = (await search.execute({ query: 'SQLite' }, exec)) as {
      count: number
      results: Array<{ id: string }>
    }
    expect(found.count).toBe(1)
    expect(found.results[0]?.id).toBe(stored.entry.id)

    const get = harness.tools.get('factory_memory_get')!
    const entry = (await get.execute({ id: stored.entry.id }, exec)) as { title: string }
    expect(entry.title).toBe('Проверка инструмента')
  })

  it('exposes agent, task and plan tools end-to-end through the tool contract', async () => {
    const harness = createHarness()
    const exec = fakeExec(harness.workspace) as never

    const agents = (await harness.tools.get('factory_agent_list')!.execute({}, exec)) as {
      count: number
      agents: Array<{ name: string }>
    }
    expect(agents.count).toBe(7)
    expect(agents.agents.map((agent) => agent.name)).toContain('DIRECTOR')

    const plan = (await harness.tools.get('factory_plan_create')!.execute(
      {
        goal: 'Проверить оркестрацию',
        steps: [
          { key: 'research', title: 'Исследовать', role: 'researcher' },
          { key: 'build', title: 'Собрать', role: 'developer', dependsOn: ['research'] },
        ],
      },
      exec,
    )) as { count: number; parentId: string; steps: Array<{ taskId: string; status: string }> }
    expect(plan.count).toBe(2)
    expect(plan.steps[0]?.status).toBe('READY')
    expect(plan.steps[1]?.status).toBe('WAITING')

    const createdTask = (await harness.tools.get('factory_task_create')!.execute(
      { title: 'Р—Р°РґР°С‡Р° С‡РµСЂРµР· tool contract', metadata: { source: 'test' }, plan: ['С€Р°Рі 1'] },
      exec,
    )) as { id: string; status: string; metadata: { source?: string } }
    expect(createdTask.status).toBe('READY')
    expect(createdTask.metadata.source).toBe('test')
    const fetchedTask = (await harness.tools.get('factory_task_get')!.execute({ id: createdTask.id }, exec)) as {
      title: string
    }
    expect(fetchedTask.title).toBe('Р—Р°РґР°С‡Р° С‡РµСЂРµР· tool contract')

    const brief = (await harness.tools.get('factory_director_brief')!.execute({}, exec)) as {
      projectId: string
      tasks: { total: number }
      nextActions: string[]
    }
    expect(brief.tasks.total).toBeGreaterThanOrEqual(3)
    expect(brief.nextActions.length).toBeGreaterThan(0)
  })

  it('reports a clean tool error when a secret is written', async () => {
    const harness = createHarness()
    const remember = harness.tools.get('factory_memory_remember')!
    await expect(
      remember.execute({ content: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, fakeExec(harness.workspace) as never),
    ).rejects.toThrowError(/секрет/)
  })

  it('sync and dashboard tools expose no arbitrary filesystem path parameter', () => {
    const harness = createHarness()
    for (const name of ['factory_sync', 'factory_dashboard']) {
      const definition = harness.tools.get(name)!
      const parameterNames = Object.keys(definition.parameters ?? {})
      expect(parameterNames).not.toEqual(expect.arrayContaining(['path', 'file_path', 'file', 'directory', 'dir']))
      expect(JSON.stringify(definition.parameters ?? {})).not.toMatch(/file_path|(^|[^a-z])path([^a-z]|$)/i)
    }
  })
})
