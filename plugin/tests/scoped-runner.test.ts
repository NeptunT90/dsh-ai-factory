import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { ScopedChildRunner, type ScopedRunInput } from '../src/agents/scoped-runner.js'
import { createTestRuntime, track } from './helpers.js'

function parentAgent(): Agent {
  return {
    id: 'ses_parent',
    session: { header: { cwd: 'C:/workspace', meta: {} } },
  } as unknown as Agent
}

function fakeAgents(captured: {
  options?: Record<string, unknown>
  restrictions?: ToolRestriction[]
  prompt?: string
  sections?: Array<{ name: string; order: number; text: string; interpolate?: boolean }>
}) {
  let releaseIdle: () => void = () => {}
  const idle = new Promise<void>((resolve) => {
    releaseIdle = resolve
  })
  const agent = {
    id: 'ses_child',
    followup(message: { content: Array<{ type: string; text?: string }> }) {
      captured.prompt = message.content.find((block) => block.type === 'text')?.text
      releaseIdle()
    },
    whenIdle: () => idle,
    cancel() {},
    session: {
      snapshotEvents: () => [
        {
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text: 'OK from child' }] } },
        },
      ],
    },
  }
  const agentCtx = {
    systemPrompt: {
      section(section: { name: string; order: number; text: string; interpolate?: boolean }) {
        captured.sections?.push(section)
        return () => {}
      },
    },
    tools: {
      definitions: () => [
        { name: 'factory_status' },
        { name: 'factory_memory_search' },
        { name: 'factory_memory_forget' },
        { name: 'read' },
      ],
      restrict(filter: ToolRestriction) {
        captured.restrictions?.push(filter)
        return () => {}
      },
    },
  }
  const registry = {
    async create(options: Record<string, unknown>) {
      captured.options = options
      await (options.setup as (ctx: unknown) => void)(agentCtx)
      return { agent, dispose: async () => {} }
    },
  }
  return registry as unknown as AgentRegistry
}

function fakeContext(registry: AgentRegistry | undefined): Context {
  return {
    get(name: string) {
      return name === 'agents' ? registry : undefined
    },
  } as unknown as Context
}

describe('ScopedChildRunner', () => {
  it('creates a child with setup restrictions and returns its last text', async () => {
    const { runtime } = track(createTestRuntime())
    const captured: { options?: Record<string, unknown>; restrictions?: ToolRestriction[]; prompt?: string; sections?: Array<{ name: string; order: number; text: string; interpolate?: boolean }> } = {
      restrictions: [],
      sections: [],
    }
    const researcher = runtime.agents.findByRole('researcher')!
    const runner = new ScopedChildRunner(fakeContext(fakeAgents(captured)), runtime)

    const result = await runner.run({
      parent: parentAgent(),
      cwd: 'C:/workspace',
      prompt: 'Исследуй тему',
      profile: researcher,
      signal: new AbortController().signal,
    })

    expect(result.stopReason).toBe('completed')
    expect(result.output).toBe('OK from child')
    expect(result.childId).toBe('ses_child')
    expect(captured.prompt).toBe('Исследуй тему')
    expect(captured.options?.meta).toMatchObject({ origin: 'subagent' })
    const deny = captured.restrictions?.[0]?.deny ?? []
    expect(deny).not.toContain('factory_memory_forget')
    expect(deny).not.toContain('factory_memory_search')
    expect(deny).toContain('read')
    expect(runtime.hasChildAllowlist('ses_child')).toBe(false)
  })

  it('registers profile and skill sections in the child system prompt', async () => {
    const { runtime } = track(createTestRuntime())
    const captured: { sections?: Array<{ name: string; order: number; text: string; interpolate?: boolean }>; prompt?: string } = {
      sections: [],
    }
    const researcher = runtime.agents.findByRole('researcher')!
    const skill = {
      apiVersion: 'factory.skill/v1' as const,
      id: 'alpha',
      name: 'Alpha',
      description: 'Alpha skill',
      version: 3,
      roles: ['researcher'] as const,
      priority: 7,
      enabled: true,
      body: 'SKILL BODY ALPHA',
      filePath: 'C:/workspace/.skills/alpha.md',
      relativePath: '.skills/alpha.md',
      hash: 'a'.repeat(64),
      bodyBytes: 16,
      fileBytes: 300,
    }
    const runner = new ScopedChildRunner(fakeContext(fakeAgents(captured)), runtime)
    const result = await runner.run({
      parent: parentAgent(),
      cwd: 'C:/workspace',
      prompt: 'TASK USER PROMPT',
      profile: researcher,
      skills: [skill],
      signal: new AbortController().signal,
    })

    expect(result.stopReason).toBe('completed')
    expect(captured.prompt).toBe('TASK USER PROMPT')
    const profile = captured.sections?.find((section) => section.name === `factory:profile:${researcher.id}`)
    const skillSection = captured.sections?.find((section) => section.name === 'factory:skill:alpha')
    expect(profile?.order).toBe(4000)
    expect(profile?.text).toBe(researcher.systemInstruction)
    expect(profile?.interpolate).toBe(false)
    expect(skillSection?.order).toBe(6007)
    expect(skillSection?.text).toContain('SKILL BODY ALPHA')
    expect(skillSection?.interpolate).toBe(false)
    expect(captured.sections?.some((section) => Object.prototype.hasOwnProperty.call(section, 'complete'))).toBe(false)
    expect(captured.prompt).not.toContain('SKILL BODY ALPHA')
  })

  it('returns an error when ctx.agents is unavailable', async () => {
    const { runtime } = track(createTestRuntime())
    const researcher = runtime.agents.findByRole('researcher')!
    const runner = new ScopedChildRunner(fakeContext(undefined), runtime)
    await expect(
      runner.run({
        parent: parentAgent(),
        cwd: 'C:/workspace',
        prompt: 'x',
        profile: researcher,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError(/ctx\.agents/)
  })
})

describe('tool allowlist', () => {
  it('denies forbidden calls for RESEARCHER with TOOL_NOT_ALLOWED', () => {
    const { runtime } = track(createTestRuntime())
    const researcher = runtime.agents.findByRole('researcher')!
    runtime.allowToolsForChild('ses_child', researcher.allowedTools)
    expect(runtime.toolDenial('ses_child', 'factory_memory_forget')).toContain('TOOL_NOT_ALLOWED')
    expect(runtime.toolDenial('ses_child', 'factory_task_cancel')).toContain('TOOL_NOT_ALLOWED')
    expect(runtime.toolDenial('ses_child', 'factory_sync')).toContain('TOOL_NOT_ALLOWED')
    expect(runtime.toolDenial('ses_child', 'factory_dashboard')).toContain('TOOL_NOT_ALLOWED')
    expect(runtime.toolDenial('ses_child', 'factory_memory_search')).toBeUndefined()
    expect(runtime.toolDenial('ses_child', 'read')).toContain('host capability read')
    expect(runtime.toolDenial('ses_child', 'write')).toContain('host capability write')
    expect(runtime.toolDenial('ses_child', 'pwsh')).toContain('host capability pwsh')
    expect(runtime.toolDenial('ses_child', 'run_code')).toContain('host capability run_code')
    expect(runtime.toolDenial('ses_child', 'read_file')).toContain('host capability read_file')
    runtime.allowToolsForChild('ses_nofile', ['factory_status'])
    expect(runtime.toolDenial('ses_nofile', 'browser_open')).toContain('host capability browser_open')
    expect(runtime.toolDenial('ses_nofile', 'browser_click')).toContain('host capability browser_click')
    expect(runtime.toolDenial('ses_nofile', 'browser_screenshot')).toContain('host capability browser_screenshot')
    runtime.releaseChildTools('ses_nofile')
    runtime.releaseChildTools('ses_child')
  })

  it('keeps orchestration tools out of child profiles', () => {
    const { runtime } = track(createTestRuntime())
    for (const name of ['DIRECTOR', 'RESEARCHER', 'DEVELOPER', 'SYSADMIN', 'ANALYST', 'EXECUTOR', 'REVIEWER']) {
      const profile = runtime.agents.list().find((agent) => agent.name === name)!
      expect(profile.allowedTools).not.toContain('factory_dispatch')
      expect(profile.allowedTools).not.toContain('factory_review')
      expect(profile.allowedTools).not.toContain('factory_workflow_run')
    }
    const reviewer = runtime.agents.list().find((agent) => agent.name === 'REVIEWER')!
    for (const denied of [
      'factory_sync',
      'factory_dashboard',
      'factory_memory_forget',
      'factory_task_cancel',
    ]) {
      expect(reviewer.allowedTools).not.toContain(denied)
    }
    const researcher = runtime.agents.list().find((agent) => agent.name === 'RESEARCHER')!
    for (const denied of ['factory_memory_forget', 'factory_task_cancel', 'factory_sync', 'factory_dashboard']) {
      expect(researcher.allowedTools).not.toContain(denied)
    }
    const sysadmin = runtime.agents.list().find((agent) => agent.name === 'SYSADMIN')!
    expect(sysadmin.allowedTools).toContain('pwsh')
    expect(sysadmin.allowedTools).not.toContain('factory_memory_remember')
    expect(sysadmin.allowedTools).not.toContain('factory_task_create')
  })
})

