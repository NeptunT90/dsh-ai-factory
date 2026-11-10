import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { CAPABILITY_DEFINITIONS } from './definitions.js'
import type {
  CapabilityDefinition,
  CapabilityVersionSource,
  DetectedCapability,
  DetectOptions,
} from './types.js'

const MAX_PATH_DIRS = 200
const MAX_VERSION_FILE_BYTES = 8 * 1024

function executableNames(definition: CapabilityDefinition, platform: NodeJS.Platform): string[] {
  const names: string[] = []
  const push = (value: string): void => {
    if (!names.includes(value)) names.push(value)
  }
  for (const base of definition.binaries) {
    push(base)
    if (platform === 'win32') {
      push(`${base}.exe`)
      push(`${base}.cmd`)
      push(`${base}.bat`)
    }
  }
  return names
}

function canonicalDirectory(value: string): string | null {
  if (!isAbsolute(value)) return null
  try {
    const canonical = realpathSync.native(value)
    const stat = lstatSync(canonical)
    return stat.isDirectory() ? canonical : null
  } catch {
    return null
  }
}

function standardDirectories(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const dirs: string[] = []
  if (platform === 'win32') {
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'LOCALAPPDATA', 'USERPROFILE']) {
      const value = env[key]
      if (value) dirs.push(value)
    }
    if (env.USERPROFILE) dirs.push(join(env.USERPROFILE, 'scoop', 'shims'))
    if (env.ProgramData) dirs.push(join(env.ProgramData, 'chocolatey', 'bin'))
  } else {
    dirs.push('/usr/local/bin', '/usr/bin', '/bin', '/usr/local/sbin', '/snap/bin', '/opt')
  }
  for (const [key, suffix] of [
    ['JAVA_HOME', 'bin'],
    ['GOROOT', 'bin'],
    ['CARGO_HOME', 'bin'],
    ['DOTNET_ROOT', ''],
    ['VIRTUAL_ENV', 'bin'],
    ['ANDROID_HOME', 'platform-tools'],
  ] as const) {
    const root = env[key]
    if (root) dirs.push(suffix === '' ? root : join(root, suffix))
  }
  return dirs
}

function trustedDirs(options: DetectOptions): string[] {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathText = options.pathDirs === undefined ? env.PATH ?? '' : options.pathDirs.join(delimiter)
  const fromPath = pathText.split(delimiter)
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of [...fromPath, ...standardDirectories(env, platform)]) {
    if (raw.trim() === '') continue
    const canonical = canonicalDirectory(raw)
    if (!canonical || seen.has(canonical)) continue
    seen.add(canonical)
    result.push(canonical)
    if (result.length >= MAX_PATH_DIRS) break
  }
  return result
}

function findExecutable(
  definition: CapabilityDefinition,
  dirs: readonly string[],
  platform: NodeJS.Platform,
): string | null {
  for (const dir of dirs) {
    for (const name of executableNames(definition, platform)) {
      const candidate = join(dir, name)
      try {
        const stat = lstatSync(candidate)
        const target = stat.isSymbolicLink() ? realpathSync.native(candidate) : candidate
        const targetStat = lstatSync(target)
        if (!targetStat.isFile()) continue
        if (platform !== 'win32') accessSync(target, constants.X_OK)
        return target
      } catch {
        // Missing/inaccessible candidates are normal; continue the allowlist.
      }
    }
  }
  return null
}

function javaVersion(path: string): { version: string | null; source: CapabilityVersionSource } {
  try {
    const bin = dirname(path)
    if (bin.toLowerCase().endsWith(`${process.platform === 'win32' ? '\\' : '/'}bin`)) {
      const release = join(dirname(bin), 'release')
      const text = readFileSync(release, { encoding: 'utf8', flag: 'r' }).slice(0, MAX_VERSION_FILE_BYTES)
      const match = /JAVA_VERSION="([^"]+)"/.exec(text)
      if (match?.[1]) return { version: match[1], source: 'file' }
    }
  } catch {
    // A missing release file is not an error.
  }
  return { version: null, source: 'none' }
}

function minimalProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (env[key] !== undefined) result[key] = env[key]
  }
  return result
}

function parseVersion(output: string): string | null {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '').trim()
  const match = /\b(\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.]+)?)\b/.exec(clean)
  return match?.[1] ?? null
}

function probeVersion(
  definition: CapabilityDefinition,
  path: string,
  options: DetectOptions,
): Promise<{ version: string | null; source: CapabilityVersionSource } | null> {
  if (options.probeMode !== 'safe' || !definition.probeArgs || definition.probeArgs.length === 0) return Promise.resolve(null)
  if (options.platform === 'win32' || process.platform === 'win32') {
    const lower = path.toLowerCase()
    // .cmd/.bat require a shell; never execute them.
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) return Promise.resolve(null)
  }
  const timeoutMs = Math.max(500, Math.min(30_000, options.probeTimeoutMs ?? 3000))
  const maxBytes = Math.max(256, Math.min(64 * 1024, options.probeMaxOutputBytes ?? 4096))
  return new Promise((resolvePromise) => {
    let settled = false
    let output = ''
    const finish = (value: { version: string | null; source: CapabilityVersionSource } | null): void => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    let child
    try {
      child = spawn(path, [...definition.probeArgs!], {
        shell: false,
        windowsHide: true,
        cwd: tmpdir(),
        env: minimalProbeEnv(options.env ?? process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      finish(null)
      return
    }
    const timer = setTimeout(() => {
      child?.kill()
      finish(null)
    }, timeoutMs)
    timer.unref?.()
    const consume = (chunk: Buffer): void => {
      if (settled) return
      output += chunk.toString('utf8')
      if (Buffer.byteLength(output, 'utf8') > maxBytes) {
        child?.kill()
        finish(null)
      }
    }
    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const version = parseVersion(output)
      finish(version === null ? null : { version, source: 'probe' })
    })
  })
}

function detectedFrom(
  definition: CapabilityDefinition,
  path: string,
  options: DetectOptions,
): DetectedCapability {
  const fileVersion = definition.id === 'java' ? javaVersion(path) : { version: null, source: 'none' as const }
  return {
    definition,
    path,
    version: fileVersion.version,
    versionSource: fileVersion.source,
    details: { binary: path },
  }
}

/**
 * Filesystem-only detection by default. Only capabilityProbeMode=safe enables
 * fixed-argv version probes. No shell, no user arguments, no network.
 */
export async function detectCapabilities(options: DetectOptions = {}): Promise<DetectedCapability[]> {
  const platform = options.platform ?? process.platform
  const dirs = trustedDirs(options)
  const found: DetectedCapability[] = []
  for (const definition of CAPABILITY_DEFINITIONS) {
    const path = findExecutable(definition, dirs, platform)
    if (path === null) continue
    const detected = detectedFrom(definition, path, options)
    if (options.probeMode === 'safe' && detected.version === null) {
      const probe = await probeVersion(definition, path, options)
      if (probe !== null) {
        found.push({ ...detected, version: probe.version, versionSource: probe.source })
        continue
      }
    }
    found.push(detected)
  }
  return found
}
