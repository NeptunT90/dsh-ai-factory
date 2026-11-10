import { isAbsolute, resolve } from 'node:path'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/**
 * Workspace root for one tool call.
 *
 * The Agent session header is the authoritative cwd; process.cwd() is only a
 * fallback for host-side calls made outside a session.
 */
export function workspaceRootOf(exec: Pick<ToolRunContext, 'agent'> | undefined): string {
  const agent = exec?.agent as unknown as { session?: { header?: { cwd?: unknown } } } | undefined
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return resolve(cwd)
  return resolve(process.cwd())
}

/**
 * Prepared for future plugin-owned file-tools; not used for host file-tools.
 * Path enforcement for DSH host file-tools is the DSH sandbox's responsibility,
 * not this plugin's.
 */
export function safeWorkspacePath(root: string, requested: string): string {
  if (requested.trim() === '') throw new Error('Путь не указан')
  const target = isAbsolute(requested) ? resolve(requested) : resolve(root, requested)
  const normalizedRoot = root.endsWith('\\') || root.endsWith('/') ? root : `${root}${process.platform === 'win32' ? '\\' : '/'}`
  const lowerTarget = process.platform === 'win32' ? target.toLowerCase() : target
  const lowerRoot = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot
  if (lowerTarget !== lowerRoot.replace(/[\\/]$/, '').toLowerCase() && !lowerTarget.startsWith(lowerRoot)) {
    throw new Error(`Путь выходит за пределы рабочей папки: ${requested}`)
  }
  return target
}
