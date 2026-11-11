import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestRuntime, track } from './helpers.js'

function writeReport(path: string, value: Record<string, unknown>): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

describe('crash recovery', () => {
  it('creates a REPAIRER task through DIRECTOR and is idempotent', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const reportPath = join(runtime.config.resolvedDataDir, 'crash-report.json')
    writeReport(reportPath, {
      format: 'factory.crash/v1',
      detectedAt: '2026-11-11T07:00:00.000Z',
      projectRoot: project.rootPath,
      exitCode: 1,
      reason: 'DSH process exited',
      restartCount: 2,
      logTail: 'fatal error: token = ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      handled: false,
    })

    const first = runtime.recoverCrashReport(reportPath)
    expect(first.handled).toBe(true)
    expect(first.taskId).toMatch(/^tsk_/)
    const task = runtime.tasks.require(first.taskId!)
    expect(task.assignedAgentId).toBe('agt_repairer')
    expect(task.createdBy).toBe('agt_director')
    expect(task.status).toBe('READY')
    expect(task.title).toContain('Crash recovery')
    expect(task.description).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(task.description).toContain('[REDACTED]')
    expect(task.metadata.crashReport).toMatchObject({ exitCode: 1, restartCount: 2 })

    const handled = JSON.parse(readFileSync(reportPath, 'utf8')) as { handled: boolean; taskId: string }
    expect(handled.handled).toBe(true)
    expect(handled.taskId).toBe(first.taskId)

    const second = runtime.recoverCrashReport(reportPath)
    expect(second.handled).toBe(false)
    expect(second.reason).toBe('already_handled')
    expect(runtime.tasks.count()).toBe(1)
  })

  it('ignores missing and malformed reports', () => {
    const { runtime } = track(createTestRuntime())
    const missing = join(runtime.config.resolvedDataDir, 'absent.json')
    expect(runtime.recoverCrashReport(missing)).toMatchObject({ handled: false, reason: 'no_report' })
    const bad = join(runtime.config.resolvedDataDir, 'bad.json')
    writeFileSync(bad, '{not-json', 'utf8')
    expect(runtime.recoverCrashReport(bad)).toMatchObject({ handled: false, reason: 'invalid_report' })
    expect(runtime.tasks.count()).toBe(0)
  })

  it('uses the default crash-report path when called without an argument', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const project = runtime.projects.require(projectId)
    const defaultPath = join(runtime.config.resolvedDataDir, 'crash-report.json')
    writeReport(defaultPath, {
      format: 'factory.crash/v1',
      projectRoot: project.rootPath,
      reason: 'boot failure',
      exitCode: 255,
      handled: false,
    })
    const result = runtime.recoverCrashReport()
    expect(result.handled).toBe(true)
    expect(runtime.tasks.list({ projectId, includeTerminal: true, limit: 10 })[0]?.assignedAgentId).toBe('agt_repairer')
  })

  it('contains one REPAIRER profile with the expected scoped allowlist', () => {
    const { runtime } = track(createTestRuntime())
    const repairer = runtime.agents.list({ limit: 20 }).find((agent) => agent.name === 'REPAIRER')
    expect(repairer?.isBuiltin).toBe(true)
    expect(repairer?.allowedTools).toEqual(['read', 'write', 'pwsh', 'factory_status', 'factory_task_list', 'git'])
    expect(existsSync(join(process.cwd(), '..', 'scripts', 'watchdog.ps1'))).toBe(true)
  })
})
