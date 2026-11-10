import type { Context } from '@deepseek-ai/cordis'
import { FactoryError, errorMessage } from './core/errors.js'
import { Config, resolveConfig, type FactoryConfig } from './config.js'
import { registerMemoryTools } from './memory/tools.js'
import { FactoryRuntime, FACTORY_VERSION, type PluginLogger } from './runtime.js'
import { registerStatusTool } from './tools/status.js'
import { registerAgentTools } from './agents/tools.js'
import { registerTaskTools } from './tasks/tools.js'
import { registerOrchestrationTools } from './orchestration/tools.js'
import { registerDispatchTool } from './dispatch/tools.js'
import { DashboardManager, registerDashboardTool } from './dashboard/tools.js'
import { registerSyncTool } from './sync/tools.js'

export const name = 'dsh-ai-factory'
export const inject = ['tools']
export const VERSION = FACTORY_VERSION
export { Config }
export type { FactoryConfig }

/**
 * DSH AI Factory host plugin.
 *
 * Initialization is synchronous because node:sqlite is synchronous. A startup
 * failure never crashes the host: `factory_status` stays available and every
 * other tool reports the exact reason.
 */
export function apply(ctx: Context, config: FactoryConfig): void {
  const logger = ctx.logger('dsh-ai-factory') as unknown as PluginLogger
  if (!config.enabled) {
    logger.info('[ai-factory] disabled by configuration; no tools registered')
    return
  }

  // Resolve paths once for a useful startup diagnostic; FactoryRuntime.create
  // repeats the validation for the real instance.
  try {
    resolveConfig(config)
  } catch (error) {
    logger.error(`[ai-factory] invalid configuration: ${errorMessage(error)}`)
    return
  }

  let runtime: FactoryRuntime | undefined
  let startupError: string | undefined
  const disposers: Array<() => void> = []
  const dashboard = new DashboardManager(
    () => runtime,
    () => ctx.tools.definitions().map(({ name, description }) => ({ name, description })),
    logger,
  )

  try {
    runtime = FactoryRuntime.create(config, logger)
    logger.info(
      `[ai-factory] v${FACTORY_VERSION} ready; driver=${runtime.db.driver}; db=${runtime.db.path}`,
    )
  } catch (error) {
    startupError = error instanceof FactoryError ? `${error.code}: ${error.message}` : errorMessage(error)
    logger.error(`[ai-factory] startup failed: ${startupError}`)
  }

  try {
    disposers.push(registerStatusTool(ctx, () => runtime, () => startupError))
    if (runtime) {
      disposers.push(...registerMemoryTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerAgentTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerTaskTools(ctx, () => runtime, () => startupError))
      disposers.push(...registerOrchestrationTools(ctx, () => runtime, () => startupError))
      disposers.push(registerDispatchTool(ctx, () => runtime, () => startupError))
      disposers.push(registerDashboardTool(ctx, dashboard))
      disposers.push(registerSyncTool(ctx, () => runtime, () => startupError))
      runtime.audit.record({
        event: 'factory.tools_registered',
        level: 'info',
        data: {
          count: disposers.length,
          groups: ['status', 'memory', 'agents', 'tasks', 'orchestration', 'dispatch', 'dashboard', 'sync'],
        },
      })
      logger.info(`[ai-factory] registered ${disposers.length} tools`)
    }
  } catch (error) {
    startupError = startupError ?? errorMessage(error)
    logger.error(`[ai-factory] tool registration failed: ${startupError}`)
  }

  ctx.effect(
    () => async () => {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose()
        } catch (error) {
          logger.warn(`[ai-factory] tool disposer failed: ${errorMessage(error)}`)
        }
      }
      await dashboard.close()
      runtime?.close()
      runtime = undefined
    },
    'dsh-ai-factory:lifecycle',
  )
}
