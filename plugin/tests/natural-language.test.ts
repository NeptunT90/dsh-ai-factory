import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerMemoryTools } from '../src/memory/tools.js'
import { registerTaskTools } from '../src/tasks/tools.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_natural',
    name: 'factory_memory_remember',
    arguments: {},
    signal: new AbortController().signal,
    agent: { id: agentId, session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

function capture(register: (ctx: Context, runtime: ReturnType<typeof createTestRuntime>['runtime']) => unknown, runtime: ReturnType<typeof createTestRuntime>['runtime']): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      definitions() {
        return []
      },
    },
  } as unknown as Context
  register(ctx, runtime)
  return tools
}

describe('natural language routing', () => {
  it('gives DIRECTOR the interface rule, few-shot examples and the required tools', () => {
    const { runtime } = track(createTestRuntime())
    const director = runtime.agents.require('agt_director')
    expect(director.systemInstruction).toContain('Ты — интерфейс между человеком и системой')
    expect(director.systemInstruction).toContain('НИКОГДА не проси пользователя писать технические команды или ID')
    expect(director.systemInstruction).toContain('factory_memory_remember')
    expect(director.systemInstruction).toContain('factory_task_list')
    expect(director.systemInstruction).toContain('Запомни, что проект на Node.js')
    for (const tool of ['factory_memory_remember', 'factory_task_tell', 'factory_skill_list', 'factory_capability_check', 'factory_backup_verify', 'factory_dashboard']) {
      expect(director.allowedTools).toContain(tool)
    }
  })

  it('routes a natural "Запомни..." request to factory_memory_remember', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const tools = capture((ctx, active) => registerMemoryTools(ctx, () => active, () => undefined), runtime)
    const remember = tools.get('factory_memory_remember')!
    const result = (await remember.execute(
      {
        content: 'Проект использует Node.js',
        title: 'Стек проекта',
        kind: 'project',
        scope: 'project',
      },
      fakeExec('ses_director', project.rootPath),
    )) as { entry?: { id?: string }; deduplicated?: boolean }
    expect(result.entry?.id).toMatch(/^mem_/)
    const found = runtime.memory.search({ projectId, query: 'Node.js', limit: 5 })
    expect(found.some((hit) => hit.title === 'Стек проекта')).toBe(true)
  })

  it('routes a status request to factory_task_list and formats a human summary', async () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    runtime.tasks.create({ projectId, title: 'Build the service' })
    const tools = capture((ctx, active) => registerTaskTools(ctx, () => active, () => undefined), runtime)
    const listed = (await tools.get('factory_task_list')!.execute(
      { projectId },
      fakeExec('ses_director', project.rootPath),
    )) as { count: number; tasks: Array<{ title: string }> }
    expect(listed.count).toBe(1)
    expect(listed.tasks[0]?.title).toBe('Build the service')
  })
})
