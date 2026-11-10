import type { CapabilityDefinition } from './types.js'

/**
 * Static capability allowlist. No definition accepts a user-supplied command,
 * path or argument; the detector only looks for these binaries and the probe
 * only runs the fixed argv below.
 */
export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  { id: 'node', name: 'Node.js', kind: 'runtime', binaries: ['node'], probeArgs: ['-v'] },
  { id: 'python', name: 'Python', kind: 'runtime', binaries: ['python', 'python3'], probeArgs: ['-I', '-S', '--version'] },
  { id: 'java', name: 'Java/JDK', kind: 'runtime', binaries: ['java'], probeArgs: ['-version'] },
  // Docker is presence-only by policy; no daemon and no --version probe.
  { id: 'docker', name: 'Docker CLI', kind: 'container', binaries: ['docker'] },
  { id: 'git', name: 'Git', kind: 'vcs', binaries: ['git'], probeArgs: ['--version'] },
  { id: 'maven', name: 'Apache Maven', kind: 'build', binaries: ['mvn'], probeArgs: ['--version'] },
  { id: 'gradle', name: 'Gradle', kind: 'build', binaries: ['gradle'], probeArgs: ['--version'] },
  { id: 'dotnet', name: '.NET SDK', kind: 'sdk', binaries: ['dotnet'], probeArgs: ['--version'] },
  { id: 'go', name: 'Go', kind: 'sdk', binaries: ['go'], probeArgs: ['version'] },
  { id: 'rust', name: 'Rust', kind: 'sdk', binaries: ['cargo', 'rustc'], probeArgs: ['--version'] },
  { id: 'npm', name: 'npm', kind: 'package_manager', binaries: ['npm'], probeArgs: ['--version'] },
  { id: 'pnpm', name: 'pnpm', kind: 'package_manager', binaries: ['pnpm'], probeArgs: ['--version'] },
  { id: 'pip', name: 'pip', kind: 'package_manager', binaries: ['pip', 'pip3'], probeArgs: ['--version'] },
  { id: 'uv', name: 'uv', kind: 'package_manager', binaries: ['uv'], probeArgs: ['--version'] },
]

export const CAPABILITY_BY_ID = new Map(CAPABILITY_DEFINITIONS.map((definition) => [definition.id, definition]))
