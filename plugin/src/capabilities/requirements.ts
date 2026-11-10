import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'

export function normalizeRequiredCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id !== '' && !result.includes(id)) result.push(id)
    if (result.length >= 100) break
  }
  return result
}

/**
 * Cache-only capability gate. It never scans. Empty/stale cache is a
 * CAPABILITY_MISSING failure so the caller can request an explicit scan.
 */
export function assertCapabilitiesAvailable(
  runtime: FactoryRuntime,
  capabilityIds: readonly string[],
  operation: string,
): void {
  const ids = [...new Set(capabilityIds.map((id) => id.trim()).filter((id) => id !== ''))]
  if (ids.length === 0) return
  const check = runtime.capabilities.check(ids.map((id) => ({ id })))
  if (check.ready) return
  throw new FactoryError(
    'CAPABILITY_MISSING',
    `Не подтверждены capabilities для ${operation}: ${ids.join(', ')}. Выполните factory_capability_scan/refresh.`,
    {
      operation,
      items: check.items.map((item) => ({
        id: item.id,
        status: item.status,
        ready: item.ready,
        reason: item.reason,
      })),
    },
  )
}
