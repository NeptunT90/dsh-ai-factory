import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export interface DumpableStore {
  dump(): Promise<Uint8Array>
}

export interface BackupSchedulerOptions {
  /** Directory for scheduled backups. Empty/undefined disables scheduling. */
  readonly dir: string
  /** Interval between backups in milliseconds. */
  readonly intervalMs: number
  /** Number of newest archives to keep. */
  readonly keep: number
}

export interface BackupResult {
  readonly file: string
  readonly bytes: number
  readonly sha256: string
  readonly pruned: number
}

/**
 * Periodic PGlite backups. The dump is consistent and includes pgvector data;
 * each archive gets a sidecar SHA256 and old archives are pruned.
 */
export class BackupScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false

  constructor(
    private readonly store: DumpableStore,
    private readonly options: BackupSchedulerOptions,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  get enabled(): boolean {
    return this.options.dir.trim() !== ''
  }

  async runOnce(): Promise<BackupResult> {
    if (!this.enabled) throw new Error('backup directory is empty')
    const dir = this.options.dir
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const suffix = Math.random().toString(16).slice(2, 8)
    const file = join(dir, `dsh-ai-factory-sync-${stamp}-${suffix}.tar.gz`)
    const bytes = await this.store.dump()
    writeFileSync(file, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(`${file}.sha256`, `${sha256}  ${file.split(/[\\/]/).pop()}\n`, 'utf8')
    const pruned = this.prune(dir)
    return { file, bytes: bytes.byteLength, sha256, pruned }
  }

  start(): void {
    if (!this.enabled || this.timer !== undefined) return
    const interval = Math.max(60_000, this.options.intervalMs)
    this.timer = setInterval(() => {
      if (this.running) return
      this.running = true
      void this.runOnce()
        .catch((error: unknown) => this.onError(error))
        .finally(() => {
          this.running = false
        })
    }, interval)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private prune(dir: string): number {
    const keep = Math.max(1, Math.min(100, Math.floor(this.options.keep)))
    const archives = readdirSync(dir)
      .filter((name) => name.startsWith('dsh-ai-factory-sync-') && name.endsWith('.tar.gz'))
      .sort()
      .reverse()
    let pruned = 0
    for (const name of archives.slice(keep)) {
      rmSync(join(dir, name), { force: true })
      rmSync(join(dir, `${name}.sha256`), { force: true })
      pruned += 1
    }
    return pruned
  }
}
