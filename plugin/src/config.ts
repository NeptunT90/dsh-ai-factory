import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const AUTONOMY_LEVELS = ['safe', 'autonomous', 'trusted'] as const
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** User-facing plugin configuration (validated by the DSH loader). */
export interface FactoryConfig {
  /** Mount AI Factory. Disable for a profile without removing installed data. */
  enabled: boolean
  /**
   * Data directory. Empty = `~/.dsh/ai-factory`. `~` and `%VARS%` are expanded.
   * Relative paths are resolved against `~/.dsh`.
   */
  dataDir: string
  /** SQLite database file name inside the data directory. */
  dbFile: string
  /** Default maximum number of search results. */
  maxSearchResults: number
  /** TTL for working memory in hours; 0 disables automatic expiry. */
  workingMemoryTtlHours: number
  /** Hard limit for one memory entry. */
  maxContentChars: number
  /** Default autonomy level recorded on tasks created by the factory. */
  defaultAutonomy: AutonomyLevel
  /** Allow entries with scope=global (user preferences, shared facts). */
  allowGlobalMemory: boolean
  /** Override the path-derived project id for portable/shared projects. */
  projectIdOverride: string
  /** Redact credential-like text before it reaches logs or audit storage. */
  redactLogs: boolean
  /** Minimum log level for AI Factory diagnostics. */
  logLevel: LogLevel
  /** Optional sync server base URL, e.g. https://factory.example.com. Empty = disabled. */
  syncUrl: string
  /** Environment variable that stores the sync bearer token; never put the token in config. */
  syncTokenEnv: string
  /** Stable device id; empty = generated and persisted locally. */
  syncDeviceId: string
  /** Maximum operations per push request. */
  syncBatchSize: number
  /** HTTP timeout for one sync request. */
  syncTimeoutMs: number
  /** Flush/pull automatically while the plugin is loaded. */
  syncAuto: boolean
  /** Auto-sync interval in seconds (minimum 15). */
  syncIntervalSeconds: number
  /** Resolve model routes and retry with fallbacks on child model failure. */
  modelRouterEnabled: boolean
  /** Comma-separated fallback routes in provider/model form. */
  modelFallbacks: string
  /** Maximum child model attempts per dispatch/review (1..3). */
  modelMaxAttempts: number
}

/** Configuration with environment-dependent values resolved. */
export interface ResolvedConfig extends FactoryConfig {
  readonly resolvedDataDir: string
  readonly resolvedDbPath: string
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default(''),
  dbFile: Schema.string().default('factory.db'),
  maxSearchResults: Schema.number().min(1).max(100).default(20),
  workingMemoryTtlHours: Schema.number().min(0).max(24 * 365).default(72),
  maxContentChars: Schema.number().min(100).max(1_000_000).default(100_000),
  defaultAutonomy: Schema.union(AUTONOMY_LEVELS).default('autonomous'),
  allowGlobalMemory: Schema.boolean().default(true),
  projectIdOverride: Schema.string().default(''),
  redactLogs: Schema.boolean().default(true),
  logLevel: Schema.union(LOG_LEVELS).default('info'),
  syncUrl: Schema.string().default(''),
  syncTokenEnv: Schema.string().default('DSH_AI_FACTORY_SYNC_TOKEN'),
  syncDeviceId: Schema.string().default(''),
  syncBatchSize: Schema.number().min(1).max(200).default(50),
  syncTimeoutMs: Schema.number().min(1000).max(60_000).default(15_000),
  syncAuto: Schema.boolean().default(false),
  syncIntervalSeconds: Schema.number().min(15).max(86_400).default(60),
  modelRouterEnabled: Schema.boolean().default(true),
  modelFallbacks: Schema.string().default(''),
  modelMaxAttempts: Schema.number().min(1).max(3).default(2),
})

const DEFAULT_DIR = join('.dsh', 'ai-factory')

/** Expand `~`, `%NAME%`/`$NAME` variables, and resolve relative paths. */
export function expandPath(input: string): string {
  let value = input.trim()
  if (value === '' || value === '~') return value === '' ? '' : homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    value = join(homedir(), value.slice(2))
  }
  value = value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole)
  value = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => process.env[name] ?? whole)
  return isAbsolute(value) ? resolve(value) : resolve(join(homedir(), '.dsh'), value)
}

/** Resolve and validate the effective paths for this plugin instance. */
export function resolveConfig(config: FactoryConfig): ResolvedConfig {
  if (config.dbFile.includes('/') || config.dbFile.includes('\\') || config.dbFile === '.' || config.dbFile === '..') {
    throw new Error('dbFile must be a plain file name, not a path')
  }
  const dataDir = config.dataDir.trim()
  const resolvedDataDir = dataDir === '' ? join(homedir(), DEFAULT_DIR) : expandPath(dataDir)
  const resolvedDbPath = join(resolvedDataDir, config.dbFile)
  return { ...config, resolvedDataDir, resolvedDbPath }
}

/** Milliseconds for the working-memory TTL, or undefined when disabled. */
export function workingMemoryTtlMs(config: ResolvedConfig): number | undefined {
  if (config.workingMemoryTtlHours <= 0) return undefined
  return config.workingMemoryTtlHours * 60 * 60 * 1000
}
