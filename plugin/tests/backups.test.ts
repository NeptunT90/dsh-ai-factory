import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as tar from 'tar'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { buildManifest } from '../src/backups/manifest.js'
import { registerBackupTools } from '../src/backups/tools.js'
import { TOOL_HEALTH_SPECS } from '../src/health/registry.js'
import { createTestRuntime, track } from './helpers.js'

function fakeExec(agentId: string, cwd: string): ToolRunContext {
  return {
    callId: 'call_backup',
    name: 'factory_backup_verify',
    arguments: {},
    signal: new AbortController().signal,
    agent: { id: agentId, session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

function toolsFor(runtime: ReturnType<typeof createTestRuntime>['runtime']): Map<string, ToolDefinition> {
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
  registerBackupTools(ctx, () => runtime, () => undefined)
  return tools
}

async function makeArchive(dbPath: string, root: string): Promise<string> {
  mkdirSync(root, { recursive: true })
  const snapshot = join(root, 'factory.db')
  const source = new DatabaseSync(dbPath, { readOnly: true })
  try {
    source.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`)
  } finally {
    source.close()
  }
  const manifest = buildManifest({ dbPath: snapshot, root, pluginVersion: '0.22.0' })
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const archive = join(root, 'backup.tar.gz')
  await tar.c({ gzip: true, file: archive, cwd: root, portable: true }, ['manifest.json', 'factory.db'])
  return archive
}

describe('backup verify/restore', () => {
  it('creates, verifies and restores an archive without losing counts', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const projectRoot = join(dir, 'project')
    const project = runtime.projects.ensure(projectRoot, 'Backup project')
    const agent = runtime.agents.create({ name: 'Backup Agent', role: 'custom' })
    runtime.tasks.create({ projectId: project.id, title: 'Backup task' })
    runtime.memory.remember({ content: 'backup memory survives', title: 'Backup memory', projectId: project.id, sourceType: 'agent' })
    expect(agent.id).toMatch(/^agt_/)
    const backupRoot = join(projectRoot, 'backups')
    const archive = await makeArchive(runtime.db.path, backupRoot)
    expect(existsSync(archive)).toBe(true)

    const tools = toolsFor(runtime)
    const exec = fakeExec('ses_root', projectRoot)
    const verified = (await tools.get('factory_backup_verify')!.execute({ archive }, exec)) as {
      ok: boolean
      schemaVersion: number
      tables: unknown[]
      errors: string[]
      temporaryRemoved: boolean
    }
    expect(verified.ok).toBe(true)
    expect(verified.schemaVersion).toBe(9)
    expect(verified.tables.length).toBeGreaterThan(5)
    expect(verified.errors).toEqual([])
    expect(verified.temporaryRemoved).toBe(true)

    const restored = (await tools.get('factory_backup_restore_test')!.execute({ archive }, exec)) as {
      ok: boolean
      agents: number
      tasks: number
      memory: number
      schemaVersion: number
      temporaryRemoved: boolean
    }
    expect(restored.ok).toBe(true)
    expect(restored.schemaVersion).toBe(9)
    expect(restored.agents).toBeGreaterThanOrEqual(1)
    expect(restored.tasks).toBe(1)
    expect(restored.memory).toBe(1)
    expect(restored.temporaryRemoved).toBe(true)
  })

  it('rejects corrupt archives and unsafe paths', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const projectRoot = join(dir, 'project')
    runtime.projects.ensure(projectRoot, 'Backup project')
    const backupRoot = join(projectRoot, 'backups')
    mkdirSync(backupRoot, { recursive: true })
    const bad = join(backupRoot, 'bad.tar.gz')
    writeFileSync(bad, 'not gzip')
    const tools = toolsFor(runtime)
    const exec = fakeExec('ses_root', projectRoot)
    const result = (await tools.get('factory_backup_verify')!.execute({ archive: bad }, exec)) as {
      ok: boolean
      errors: string[]
      temporaryRemoved: boolean
    }
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.temporaryRemoved).toBe(true)

    await expect(
      tools.get('factory_backup_verify')!.execute({ archive: join(projectRoot, 'outside.tar.gz') }, exec),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('is root-only and reports 62 factory tools / 70 actions', async () => {
    const { runtime, dir } = track(createTestRuntime())
    const projectRoot = join(dir, 'project')
    runtime.projects.ensure(projectRoot, 'Backup project')
    const tools = toolsFor(runtime)
    runtime.allowToolsForChild('ses_child', ['factory_backup_verify', 'factory_backup_restore_test'])
    await expect(
      tools.get('factory_backup_verify')!.execute(
        { archive: join(projectRoot, 'backups', 'missing.tar.gz') },
        fakeExec('ses_child', projectRoot),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(new Set(TOOL_HEALTH_SPECS.map((spec) => spec.tool)).size).toBe(62)
    expect(TOOL_HEALTH_SPECS).toHaveLength(70)
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_backup_verify')?.mode).toBe('observed')
    expect(TOOL_HEALTH_SPECS.find((spec) => spec.tool === 'factory_backup_restore_test')?.risk).toBe('R1')
  })
})
