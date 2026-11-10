import { afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FactoryRuntime } from '../src/runtime.js'
import type { FactoryConfig } from '../src/config.js'

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

export function testConfig(dataDir: string, overrides: Partial<FactoryConfig> = {}): FactoryConfig {
  return {
    enabled: true,
    dataDir,
    dbFile: 'factory-test.db',
    maxSearchResults: 20,
    workingMemoryTtlHours: 72,
    maxContentChars: 100_000,
    defaultAutonomy: 'autonomous',
    allowGlobalMemory: true,
    projectIdOverride: '',
    redactLogs: true,
    logLevel: 'info',
    syncUrl: '',
    syncTokenEnv: 'DSH_AI_FACTORY_SYNC_TOKEN',
    syncDeviceId: '',
    syncBatchSize: 50,
    syncTimeoutMs: 15_000,
    syncAuto: false,
    syncIntervalSeconds: 60,
    modelRouterEnabled: true,
    modelFallbacks: '',
    modelMaxAttempts: 2,
    ...overrides,
  }
}

export interface TestRuntime {
  runtime: FactoryRuntime
  dir: string
  projectId: string
  cleanup(): void
}

export function createTestRuntime(overrides: Partial<FactoryConfig> = {}): TestRuntime {
  const dir = mkdtempSync(join(tmpdir(), 'ai-factory-test-'))
  const runtime = FactoryRuntime.create(testConfig(dir, overrides), silentLogger)
  const project = runtime.projects.ensure(join(dir, 'workspace'), 'Test workspace')
  return {
    runtime,
    dir,
    projectId: project.id,
    cleanup() {
      runtime.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

export function track(testRuntime: TestRuntime): TestRuntime {
  cleanups.push(() => testRuntime.cleanup())
  return testRuntime
}
